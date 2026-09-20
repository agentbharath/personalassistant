import { judgeReplyForUser, peekReplyJudgement } from "@/lib/agents/reply-needed-runtime";
import { REPLY_WINDOW_DAYS, replyCandidates, type MailRef, type ReplyJudgement, type ReplyKind } from "@/lib/agents/reply-needed";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { GoogleGmailAccessError, readGmailMessage, searchGmail, searchGmailInThreads } from "@/lib/tools/email/google-gmail";
import { createEncryptedCache, type TextCache } from "@/lib/runtime/encrypted-cache";
import { listDismissedThreads, loadPerchPrefs, threadKey, type PerchPrefs } from "./dismissals";
import { reportFailure } from "@/lib/observability/report";

export type WaitingReply = { threadId: string; messageId: string; from: string; subject: string; receivedAt: number; reason: string; kind: ReplyKind };
/** `items` are everything the model says needs a reply; the card shows the kinds the owner chose and says how many it is hiding. */
export type WaitingResult = { state: "ok"; items: WaitingReply[]; /** Messages checked this visit, and the messages that could be waiting (checked or not yet). */ checked: number; total: number; prefs: PerchPrefs }
  /** The owner has not answered the first-visit question. No mail is read until they do. */
  | { state: "setup"; prefs: PerchPrefs }
  /** The owner turned reminders off. */
  | { state: "off" } | { state: "needs_connection" } | { state: "unavailable" };

/** Judged per visit, newest first. What is not reached is judged on the next visit, because judgements are remembered. */
const MAX_JUDGED_PER_VISIT = 30;
const BUDGET_MS = 8_000;

export const inboundQuery = `in:inbox (category:primary OR category:updates) newer_than:${REPLY_WINDOW_DAYS}d -from:me`;
export const sentQuery = `in:sent newer_than:${REPLY_WINDOW_DAYS}d`;

export function displayName(from: string) {
  const name = from.replace(/<[^>]*>/, "").replace(/^["'\s]+|["'\s]+$/g, "");
  return name || from.replace(/[<>]/g, "");
}

/** How long the two Gmail searches are kept, so changing a setting or coming back a minute later does not read the mailbox again. */
const SCAN_TTL_SECONDS = 180;
const scanCache = createEncryptedCache({ prefix: "reply-scan", ttlSeconds: SCAN_TTL_SECONDS });

type Scan = { inbound: MailRef[]; sent: Array<{ threadId: string; receivedAt: number }> };

const defaultDeps = { search: searchGmail, searchIn: searchGmailInThreads, read: readGmailMessage, judge: judgeReplyForUser, peek: peekReplyJudgement, dismissed: listDismissedThreads, prefs: loadPerchPrefs, scan: scanCache as TextCache | null };

export async function loadWaitingReplies(userId: string, deps = defaultDeps): Promise<WaitingResult> {
  try {
    // Reminders are opt-in: read no mail, and spend nothing, until the owner has chosen.
    const prefs = await deps.prefs(userId);
    if (!prefs.saved) return { state: "setup", prefs };
    if (!prefs.remindersEnabled) return { state: "off" };

    const [scan, dismissed] = await Promise.all([loadScan(userId, deps), deps.dismissed(userId)]);
    const candidates = replyCandidates(scan.inbound, scan.sent).filter((message) => !dismissed.has(threadKey(message.threadId)));

    // Messages judged before are answered from memory. Only new ones are read from Gmail and sent to the model, a bounded number per visit.
    const found: WaitingReply[] = [];
    let checked = 0;
    const record = (message: MailRef, judgement: ReplyJudgement | null | undefined) => {
      if (!judgement) return;
      checked += 1;
      if (judgement.needsReply) found.push({ threadId: message.threadId, messageId: message.id, from: message.from, subject: message.subject, receivedAt: message.receivedAt, reason: judgement.reason, kind: judgement.kind === "none" ? "person" : judgement.kind });
    };
    const remembered = await Promise.all(candidates.map(async (message) => ({ message, judgement: await deps.peek(userId, message.id) })));
    for (const { message, judgement } of remembered) if (judgement) record(message, judgement);
    const fresh = remembered.filter((entry) => !entry.judgement).map((entry) => entry.message).slice(0, MAX_JUDGED_PER_VISIT);

    let failed = 0;
    let lastFailure: unknown;
    const work = Promise.all(fresh.map(async (message) => {
      try {
        const email = await deps.read(userId, message.id);
        record(message, await deps.judge({ userId, messageId: message.id, from: message.from, subject: message.subject, text: email.text || message.snippet, sentAt: new Date(message.receivedAt).toISOString() }));
      } catch (error) { failed += 1; lastFailure = error; /* leave it for the next visit */ }
    }));
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, BUDGET_MS))]);
    if (failed > 0) reportFailure("waiting_replies_partial", lastFailure, { failed, checkedNew: fresh.length }, { userId });
    // Waiting longest first: those are the ones most likely to be forgotten.
    return { state: "ok", items: [...found].sort((left, right) => left.receivedAt - right.receivedAt), checked, total: candidates.length, prefs };
  } catch (error) {
    // A Google connection that needs renewing is expected and handled; anything else is worth knowing about.
    if (!(error instanceof GoogleConnectionRequiredError)) reportFailure("waiting_replies_failed", error, {}, { userId });
    if (error instanceof GoogleConnectionRequiredError || (error instanceof GoogleGmailAccessError && error.reason === "insufficient_scope")) return { state: "needs_connection" };
    return { state: "unavailable" };
  }
}

async function loadScan(userId: string, deps: typeof defaultDeps): Promise<Scan> {
  const material = `scan|${userId}`;
  try {
    const cached = await deps.scan?.get(material);
    if (cached) return JSON.parse(cached) as Scan;
  } catch { /* A cache problem never blocks an answer. */ }
  const inbound = await deps.search(userId, inboundQuery, 60);
  // Only the owner's sent mail in the same threads matters, so headers are read for those alone.
  const sent = await deps.searchIn(userId, sentQuery, 100, new Set(inbound.map((message) => message.threadId)));
  const scan: Scan = { inbound, sent: sent.map((message) => ({ threadId: message.threadId, receivedAt: message.receivedAt })) };
  try { await deps.scan?.set(material, JSON.stringify(scan)); } catch { /* optional */ }
  return scan;
}
