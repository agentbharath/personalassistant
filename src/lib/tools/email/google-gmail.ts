import { schemaOrders } from "@/lib/finance-sync/structured-order";
import { assertToolAllowed } from "@/lib/agents/registry";
import { withGoogleCredential } from "@/lib/auth/google-credential-broker";
import { gmailFetch, GoogleGmailAccessError, gmailFailureMessage } from "./gmail-transport";
export { GoogleGmailAccessError } from "./gmail-transport";
import { createEncryptedCache } from "@/lib/runtime/encrypted-cache";

export type EmailSearchResult = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  receivedAt: number;
  snippet: string;
  /** The To header, when the search asked for it. Used to find who the owner writes to. */
  to?: string;
};

export type EmailAttachment = { id: string; filename: string; mimeType: string; size: number };
/** What a reply needs to sit under the message it answers (R25): the message's own id, the chain before it, and where replies should go. */
export type ReplyHeaders = { messageId: string; references: string[]; replyTo: string; to: string };
export type EmailContent = EmailSearchResult & { structuredOrders?: Record<string, unknown>[]; text: string; attachments: EmailAttachment[]; reply: ReplyHeaders };

export async function readGmailMessage(userId: string, messageId: string): Promise<EmailContent> {
  assertToolAllowed("email", "email.read");
  return withGoogleCredential(userId, "email", async (accessToken) => {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
    url.searchParams.set("format", "full");
    const response = await gmailFetch(url, accessToken);
    const body = await response.json() as GmailFullMessage;
    const headers = new Map((body.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
    return {
      id: body.id,
      threadId: body.threadId,
      subject: headers.get("subject") ?? "(No subject)",
      from: headers.get("from") ?? "Unknown sender",
      date: headers.get("date") ?? "",
      receivedAt: Number(body.internalDate ?? 0),
      snippet: decodeEntities(body.snippet ?? ""),
      text: cleanBodyText(collectText(body.payload)).slice(0, 150_000),
      attachments: collectAttachments(body.payload),
      structuredOrders: collectStructuredOrders(body.payload),
      reply: {
        messageId: headers.get("message-id") ?? "",
        references: (headers.get("references") ?? "").split(/\s+/).filter(Boolean),
        replyTo: headers.get("reply-to") ?? "",
        to: headers.get("to") ?? "",
      },
    };
  });
}

export async function readGmailAttachment(userId: string, messageId: string, attachmentId: string) {
  assertToolAllowed("email", "email.read");
  return withGoogleCredential(userId, "email", async (accessToken) => {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    const response = await gmailFetch(url, accessToken);
    const body = await response.json() as { data?: string; size?: number };
    if (!body.data) throw new GoogleGmailAccessError("unavailable");
    return { data: body.data, size: Number(body.size ?? 0) };
  });
}

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
  headers?: Array<{ name: string; value: string }>;
};
type GmailFullMessage = { id: string; threadId: string; internalDate?: string; snippet?: string; payload?: GmailPart };

function collectStructuredOrders(part?: GmailPart): Record<string, unknown>[] {
  if (!part) return [];
  const own = part.mimeType === "text/html" && part.body?.data ? schemaOrders(decodeBase64Url(part.body.data)) : [];
  return [...own, ...(part.parts ?? []).flatMap(collectStructuredOrders)].slice(0, 10);
}

function collectText(part?: GmailPart): string {
  if (!part) return "";
  const own = part.body?.data && (part.mimeType === "text/plain" || part.mimeType === "text/html")
    ? decodeBase64Url(part.body.data)
    : "";
  const children = (part.parts ?? []).map(collectText).filter(Boolean).join("\n");
  const combined = [own, children].filter(Boolean).join("\n");
  return part.mimeType === "text/html" ? stripHtml(combined) : combined;
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function stripHtml(value: string) {
  return decodeEntities(value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/&nbsp;|&zwnj;|&shy;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectAttachments(part?: GmailPart): EmailAttachment[] {
  if (!part) return [];
  const own = part.body?.attachmentId && part.filename
    ? [{ id: part.body.attachmentId, filename: part.filename, mimeType: part.mimeType ?? "application/octet-stream", size: Number(part.body.size ?? 0) }]
    : [];
  return [...own, ...(part.parts ?? []).flatMap(collectAttachments)];
}

/** Runs `task` over `items` with at most `limit` in flight, so a large search does not trip Gmail's per-user rate limit. */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await task(items[index]) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

export type MessageRef = { id: string; threadId: string };
const METADATA_CONCURRENCY = 6;
class GmailScanDeferredError extends Error {}
const summaryCache = createEncryptedCache({ prefix: "gmail-summary-v1", ttlSeconds: 30 * 24 * 60 * 60, memoryLimit: 5000 });

async function listMessageRefs(accessToken: string, query: string, maxResults: number, deadlineAt = Infinity) {
  const refs: MessageRef[] = [];
  let pageToken: string | undefined;
  do {
    if (Date.now() >= deadlineAt) return { refs, truncated: true };
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.search = new URLSearchParams({ q: query, maxResults: String(Math.min(500, maxResults - refs.length)), ...(pageToken ? { pageToken } : {}) }).toString();
    const body = (await (await gmailFetch(listUrl, accessToken, deadlineAt)).json()) as { messages?: MessageRef[]; nextPageToken?: string };
    refs.push(...(body.messages ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken && refs.length < maxResults);
  return { refs: refs.slice(0, maxResults), truncated: Boolean(pageToken) || refs.length > maxResults };
}

/** Fetches each message's headers, a few at a time. A message that fails is left out; only if every one fails is the whole search an error. */
async function messageSummaries(accessToken: string, refs: MessageRef[], options?: { userId: string; deadlineAt?: number }) {
  let stopped: unknown;
  const settled = await mapLimit(refs, METADATA_CONCURRENCY, async (message) => {
    if (stopped) throw new GmailScanDeferredError();
    assertToolAllowed("email", "email.read");
    if (Date.now() >= (options?.deadlineAt ?? Infinity)) throw new GmailScanDeferredError();
    const cacheKey = options ? `${options.userId}:${message.id}` : null;
    if (cacheKey) {
      try { const cached = await summaryCache.get(cacheKey); if (cached) return JSON.parse(cached) as EmailSearchResult; } catch { /* optional cache */ }
    }
    if (Date.now() >= (options?.deadlineAt ?? Infinity)) throw new GmailScanDeferredError();
    const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`);
    messageUrl.searchParams.set("format", "metadata");
    messageUrl.searchParams.set("fields", "id,threadId,internalDate,snippet,payload/headers");
    messageUrl.searchParams.append("metadataHeaders", "Subject");
    messageUrl.searchParams.append("metadataHeaders", "From");
    messageUrl.searchParams.append("metadataHeaders", "Date");
    messageUrl.searchParams.append("metadataHeaders", "To");
    let response: Response;
    try { response = await gmailFetch(messageUrl, accessToken, options?.deadlineAt); }
    catch (error) {
      if (error instanceof GoogleGmailAccessError && error.reason !== "not_found") stopped = error;
      if (Date.now() >= (options?.deadlineAt ?? Infinity)) throw new GmailScanDeferredError();
      throw error;
    }
    const body = await response.json() as { id: string; threadId: string; internalDate?: string; snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
    const headers = new Map((body.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
    const summary: EmailSearchResult = {
      id: body.id,
      threadId: body.threadId,
      subject: headers.get("subject") ?? "(No subject)",
      from: headers.get("from") ?? "Unknown sender",
      date: headers.get("date") ?? "",
      receivedAt: Number(body.internalDate ?? 0),
      snippet: decodeEntities(body.snippet ?? ""),
      to: headers.get("to") ?? "",
    };
    if (cacheKey) { try { await summaryCache.set(cacheKey, JSON.stringify(summary)); } catch { /* optional cache */ } }
    return summary;
  });
  // Let the credential broker refresh rejected access instead of hiding it as missing mail.
  if (stopped instanceof GoogleGmailAccessError && ["insufficient_scope", "forbidden", "api_disabled", "quota_exceeded", "invalid_request"].includes(stopped.reason)) throw stopped;
  const failures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  const unreadCount = failures.filter((entry) => entry.reason instanceof GmailScanDeferredError).length;
  const failureReasons = [...new Set(failures.flatMap((entry) => entry.reason instanceof GoogleGmailAccessError ? [gmailFailureMessage(entry.reason)] : []))];
  const results = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
  if (!options && refs.length > 0 && results.length === 0) throw (settled.find((entry) => entry.status === "rejected") as PromiseRejectedResult).reason;
  const pendingRefs = refs.filter((_, index) => settled[index].status === "rejected" && (settled[index] as PromiseRejectedResult).reason?.reason !== "not_found");
  const unavailableCount = failures.filter(entry => entry.reason instanceof GoogleGmailAccessError && entry.reason.reason === "not_found").length;
  const retryAt = Math.max(0, ...failures.map(entry => entry.reason instanceof GoogleGmailAccessError && entry.reason.reason === "rate_limited" ? Date.now() + (entry.reason.retryAfterMs ?? 30_000) : 0));
  return { pendingRefs, unavailableCount, retryAt, messages: results.sort((left, right) => right.receivedAt - left.receivedAt), failedCount: failures.length - unreadCount, unreadCount, failureReasons };
}

export async function searchGmail(userId: string, query: string, maxResults = 20): Promise<EmailSearchResult[]> {
  assertToolAllowed("email", "email.search");
  return withGoogleCredential(userId, "email", async (accessToken) => (await messageSummaries(accessToken, (await listMessageRefs(accessToken, query, maxResults)).refs)).messages);
}

/** A spending scan must disclose both pagination limits and unreadable messages. */
export async function searchGmailForImport(userId: string, query: string, maxResults: number, deadlineAt?: number, options?: { prioritizePayments?: boolean; cursor?: GmailImportCursor; onProgress?: () => Promise<void>; skipKnown?: (ids: string[]) => Promise<Set<string>> }) {
  assertToolAllowed("email", "email.search");
  return withGoogleCredential(userId, "email", async (accessToken) => {
    if (options?.cursor) return advanceImportCursor(accessToken, userId, options.cursor, maxResults, deadlineAt ?? Infinity, options.onProgress, options.skipKnown);
    // Read payment notices first so older card payments aren't buried behind recent general mail.
    const priority = options?.prioritizePayments
      ? await listMessageRefs(accessToken, `${query} {subject:payment subject:paid subject:autopay}`, Math.min(maxResults, 250), deadlineAt)
      : { refs: [] as MessageRef[], truncated: false };
    const first = await messageSummaries(accessToken, priority.refs, { userId, deadlineAt });
    const listed = await listMessageRefs(accessToken, query, maxResults, deadlineAt);
    const readIds = new Set(priority.refs.map((message) => message.id));
    const remaining = listed.refs.filter((message) => !readIds.has(message.id));
    const summaries = await messageSummaries(accessToken, remaining, { userId, deadlineAt });
    return {
      ...summaries,
      messages: [...first.messages, ...summaries.messages],
      truncated: listed.truncated,
      failureReasons: [...new Set([...first.failureReasons, ...summaries.failureReasons])],
      // Each message is attempted in one pass; failures remain visible even if the broad pass is truncated.
      failedCount: summaries.failedCount + first.failedCount,
      unreadCount: summaries.unreadCount + first.unreadCount,
    };
  });
}

/** Like `searchGmail`, but only reads the headers of matches that are in one of the given threads. The list call already says which thread each match is in, so the rest cost nothing. */
export async function searchGmailInThreads(userId: string, query: string, maxResults: number, threadIds: Set<string>): Promise<EmailSearchResult[]> {
  assertToolAllowed("email", "email.search");
  return withGoogleCredential(userId, "email", async (accessToken) => (await messageSummaries(accessToken, (await listMessageRefs(accessToken, query, maxResults)).refs.filter((message) => threadIds.has(message.threadId)))).messages);
}

const namedEntities: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", dollar: "$", nbsp: " " };

// Marketing mail pads previews with invisible characters (U+034F, zero-width spaces, soft hyphens).
function decodeEntities(value: string) {
  return value
    .replace(/[\u034F\u200B-\u200F\u2060\uFEFF\u00AD]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(quot|amp|lt|gt|apos|dollar|nbsp);/g, (_, name) => namedEntities[name]);
}

/** Tracking links can fill tens of thousands of characters and push the actual content out of view. */
export function cleanBodyText(value: string) {
  return value.replace(/https?:\/\/\S+/gi, " [link] ").replace(/(?:\[link\]\s*){2,}/g, "[link] ").replace(/\s+/g, " ").trim();
}


export type GmailImportCursor = {
  queries: string[];
  stage: number;
  pageToken?: string;
  pageLoaded: boolean;
  pending: MessageRef[];
  seen: string[];
  ready: EmailSearchResult[];
  checked: number;
  unavailable: number;
  retryAt: number;
};

/** Disjoint phases: finish Primary/Updates before scanning other categories, with payments first in each. */
export function newGmailImportCursor(query: string): GmailImportCursor {
  const priority = "{category:primary category:updates}";
  const other = "-category:primary -category:updates";
  const payments = "{subject:payment subject:paid subject:autopay}";
  const rest = "-subject:payment -subject:paid -subject:autopay";
  return { queries: [`${query} ${priority} ${payments}`, `${query} ${priority} ${rest}`, `${query} ${other} ${payments}`, `${query} ${other} ${rest}`], stage: 0, pageLoaded: false, pending: [], seen: [], ready: [], checked: 0, unavailable: 0, retryAt: 0 };
}

async function advanceImportCursor(accessToken: string, userId: string, cursor: GmailImportCursor, limit: number, deadlineAt: number, save?: () => Promise<void>, skipKnown?: (ids: string[]) => Promise<Set<string>>) {
  const seen = new Set(cursor.seen);
  const checkedKnown = new Set<string>();
  let failedCount = 0;
  let failureReasons: string[] = [];
  const startChecked = cursor.checked;
  while (cursor.stage < cursor.queries.length && cursor.checked - startChecked < limit && Date.now() < deadlineAt && Date.now() >= cursor.retryAt) {
    if (!cursor.pending.length) {
      if (cursor.pageLoaded && !cursor.pageToken) { cursor.stage++; cursor.pageLoaded = false; await save?.(); continue; }
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.search = new URLSearchParams({ q: cursor.queries[cursor.stage], maxResults: "100", ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}) }).toString();
      try {
        const body = await (await gmailFetch(url, accessToken, deadlineAt)).json() as { messages?: MessageRef[]; nextPageToken?: string };
        cursor.pending = (body.messages ?? []).filter(ref => !seen.has(ref.id));
        cursor.pageToken = body.nextPageToken;
        cursor.pageLoaded = true;
        await save?.();
      } catch (error) {
        if (error instanceof GoogleGmailAccessError && error.reason === "invalid_request" && cursor.pageToken) {
          cursor.pageToken = undefined; cursor.pageLoaded = false; await save?.(); continue;
        }
        if (error instanceof GoogleGmailAccessError && ["rate_limited", "unavailable"].includes(error.reason)) {
          cursor.retryAt = Date.now() + (error.retryAfterMs ?? 30_000);
          failureReasons = [gmailFailureMessage(error)];
          await save?.();
          break;
        }
        if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) break;
        throw error;
      }
      if (!cursor.pending.length) continue;
    }
    if (skipKnown && cursor.pending.length) {
      const unchecked = cursor.pending.filter(ref => !checkedKnown.has(ref.id)).slice(0, 80).map(ref => ref.id);
      const skipped = unchecked.length ? await skipKnown(unchecked) : new Set<string>();
      unchecked.forEach(id => checkedKnown.add(id));
      for (const ref of cursor.pending) if (skipped.has(ref.id) && !seen.has(ref.id)) { seen.add(ref.id); cursor.seen.push(ref.id); cursor.checked++; }
      cursor.pending = cursor.pending.filter(ref => !seen.has(ref.id));
      if (skipped.size) await save?.();
      if (!cursor.pending.length) continue;
    }
    const chunk = cursor.pending.slice(0, METADATA_CONCURRENCY);
    const result = await messageSummaries(accessToken, chunk, { userId, deadlineAt });
    const pending = new Set(result.pendingRefs.map(ref => ref.id));
    for (const ref of chunk) if (!pending.has(ref.id)) { seen.add(ref.id); cursor.seen.push(ref.id); cursor.checked++; }
    cursor.pending = cursor.pending.filter(ref => !seen.has(ref.id));
    cursor.ready.push(...result.messages);
    cursor.unavailable += result.unavailableCount;
    cursor.retryAt = result.retryAt;
    failedCount += result.failedCount - result.unavailableCount;
    failureReasons = result.failureReasons;
    await save?.();
    if (pending.size) break;
  }
  return { messages: cursor.ready, truncated: cursor.stage < cursor.queries.length, failedCount, unreadCount: cursor.pending.length, failureReasons };
}
