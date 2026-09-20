import { judgeReplyForUser } from "@/lib/agents/reply-needed-runtime";
import { REPLY_WINDOW_DAYS, replyCandidates, type ReplyJudgement, type ReplyKind } from "@/lib/agents/reply-needed";
import { GoogleConnectionRequiredError } from "@/lib/auth/google-credential-broker";
import { GoogleGmailAccessError, readGmailMessage, searchGmail } from "@/lib/tools/email/google-gmail";
import { listDismissedThreads, loadPerchPrefs, threadKey, type PerchPrefs } from "./dismissals";

export type WaitingReply = { threadId: string; messageId: string; from: string; subject: string; receivedAt: number; reason: string; kind: ReplyKind };
/** `items` are everything the model says needs a reply; the card shows the kinds the owner chose and says how many it is hiding. */
export type WaitingResult = { state: "ok"; items: WaitingReply[]; pending: number; prefs: PerchPrefs }
  /** The owner has not answered the first-visit question. No mail is read until they do. */
  | { state: "setup"; prefs: PerchPrefs }
  /** The owner turned reminders off. */
  | { state: "off" } | { state: "needs_connection" } | { state: "unavailable" };

/** Judged per visit, newest first. What is not reached is judged on the next visit, because judgements are remembered. */
const MAX_JUDGED_PER_VISIT = 20;
const BUDGET_MS = 8_000;

export const inboundQuery = `in:inbox (category:primary OR category:updates) newer_than:${REPLY_WINDOW_DAYS}d -from:me`;
export const sentQuery = `in:sent newer_than:${REPLY_WINDOW_DAYS}d`;

export function displayName(from: string) {
  const name = from.replace(/<[^>]*>/, "").replace(/^["'\s]+|["'\s]+$/g, "");
  return name || from.replace(/[<>]/g, "");
}

export async function loadWaitingReplies(userId: string, deps = { search: searchGmail, read: readGmailMessage, judge: judgeReplyForUser, dismissed: listDismissedThreads, prefs: loadPerchPrefs }): Promise<WaitingResult> {
  try {
    // Reminders are opt-in: read no mail, and spend nothing, until the owner has chosen.
    const prefs = await deps.prefs(userId);
    if (!prefs.saved) return { state: "setup", prefs };
    if (!prefs.remindersEnabled) return { state: "off" };
    const [inbound, sent, dismissed] = await Promise.all([deps.search(userId, inboundQuery, 60), deps.search(userId, sentQuery, 60), deps.dismissed(userId)]);
    const candidates = replyCandidates(inbound, sent).filter((message) => !dismissed.has(threadKey(message.threadId)));
    const batch = candidates.slice(0, MAX_JUDGED_PER_VISIT);

    const found: WaitingReply[] = [];
    let settledCount = 0;
    const work = Promise.all(batch.map(async (message) => {
      let judgement: ReplyJudgement | null = null;
      try {
        const email = await deps.read(userId, message.id);
        judgement = await deps.judge({ userId, messageId: message.id, from: message.from, subject: message.subject, text: email.text || message.snippet, sentAt: new Date(message.receivedAt).toISOString() });
      } catch { /* leave it for the next visit */ }
      settledCount += 1;
      if (judgement?.needsReply) found.push({ threadId: message.threadId, messageId: message.id, from: message.from, subject: message.subject, receivedAt: message.receivedAt, reason: judgement.reason, kind: judgement.kind === "none" ? "person" : judgement.kind });
    }));
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, BUDGET_MS))]);
    // Waiting longest first: those are the ones most likely to be forgotten.
    return { state: "ok", items: [...found].sort((left, right) => left.receivedAt - right.receivedAt), pending: candidates.length - Math.min(settledCount, batch.length), prefs };
  } catch (error) {
    if (error instanceof GoogleConnectionRequiredError || (error instanceof GoogleGmailAccessError && error.reason === "insufficient_scope")) return { state: "needs_connection" };
    return { state: "unavailable" };
  }
}
