import { assertToolAllowed } from "@/lib/agents/registry";
import { withGoogleCredential } from "@/lib/auth/google-credential-broker";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

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
export type EmailContent = EmailSearchResult & { text: string; attachments: EmailAttachment[]; reply: ReplyHeaders };

export class GoogleGmailAccessError extends Error {
  constructor(public readonly reason: "api_disabled" | "insufficient_scope" | "forbidden" | "unavailable") {
    super(`Google Gmail access failed: ${reason}`);
    this.name = "GoogleGmailAccessError";
  }
}

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

type MessageRef = { id: string; threadId: string };
const METADATA_CONCURRENCY = 6;

async function listMessageRefs(accessToken: string, query: string, maxResults: number): Promise<MessageRef[]> {
  const refs: MessageRef[] = [];
  let pageToken: string | undefined;
  do {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.search = new URLSearchParams({ q: query, maxResults: String(Math.min(500, maxResults - refs.length)), ...(pageToken ? { pageToken } : {}) }).toString();
    const body = (await (await gmailFetch(listUrl, accessToken)).json()) as { messages?: MessageRef[]; nextPageToken?: string };
    refs.push(...(body.messages ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken && refs.length < maxResults);
  return refs.slice(0, maxResults);
}

/** Fetches each message's headers, a few at a time. A message that fails is left out; only if every one fails is the whole search an error. */
async function messageSummaries(accessToken: string, refs: MessageRef[]): Promise<EmailSearchResult[]> {
  const settled = await mapLimit(refs, METADATA_CONCURRENCY, async (message) => {
    assertToolAllowed("email", "email.read");
    const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`);
    messageUrl.searchParams.set("format", "metadata");
    messageUrl.searchParams.set("fields", "id,threadId,internalDate,snippet,payload/headers");
    messageUrl.searchParams.append("metadataHeaders", "Subject");
    messageUrl.searchParams.append("metadataHeaders", "From");
    messageUrl.searchParams.append("metadataHeaders", "Date");
    messageUrl.searchParams.append("metadataHeaders", "To");
    const response = await gmailFetch(messageUrl, accessToken);
    const body = await response.json() as { id: string; threadId: string; internalDate?: string; snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
    const headers = new Map((body.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
    return {
      id: body.id,
      threadId: body.threadId,
      subject: headers.get("subject") ?? "(No subject)",
      from: headers.get("from") ?? "Unknown sender",
      date: headers.get("date") ?? "",
      receivedAt: Number(body.internalDate ?? 0),
      snippet: decodeEntities(body.snippet ?? ""),
      to: headers.get("to") ?? "",
    };
  });
  const results = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
  if (refs.length > 0 && results.length === 0) throw (settled.find((entry) => entry.status === "rejected") as PromiseRejectedResult).reason;
  return results.sort((left, right) => right.receivedAt - left.receivedAt);
}

export async function searchGmail(userId: string, query: string, maxResults = 20): Promise<EmailSearchResult[]> {
  assertToolAllowed("email", "email.search");
  return withGoogleCredential(userId, "email", async (accessToken) => messageSummaries(accessToken, await listMessageRefs(accessToken, query, maxResults)));
}

/** Like `searchGmail`, but only reads the headers of matches that are in one of the given threads. The list call already says which thread each match is in, so the rest cost nothing. */
export async function searchGmailInThreads(userId: string, query: string, maxResults: number, threadIds: Set<string>): Promise<EmailSearchResult[]> {
  assertToolAllowed("email", "email.search");
  return withGoogleCredential(userId, "email", async (accessToken) => messageSummaries(accessToken, (await listMessageRefs(accessToken, query, maxResults)).filter((message) => threadIds.has(message.threadId))));
}

async function gmailFetch(url: URL, accessToken: string) {
  const response = await resilientFetch("google_gmail", url, { headers: { authorization: `Bearer ${accessToken}` } }, { timeoutMs: 8_000, maxAttempts: 2 });
  if (response.ok) return response;
  const body = await response.json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null;
  const reason = body?.error?.errors?.[0]?.reason;
  if (response.status === 403 && (reason === "accessNotConfigured" || reason === "serviceDisabled")) throw new GoogleGmailAccessError("api_disabled");
  if (response.status === 401 || (response.status === 403 && reason === "insufficientPermissions")) throw new GoogleGmailAccessError("insufficient_scope");
  if (response.status === 403) throw new GoogleGmailAccessError("forbidden");
  throw new GoogleGmailAccessError("unavailable");
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
