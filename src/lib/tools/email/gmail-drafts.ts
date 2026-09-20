import { withGoogleCredential } from "@/lib/auth/google-credential-broker";

/**
 * The ONLY code in Daylark that writes to a mailbox, and it can do exactly four things: create a draft, read one, update one, delete one.
 * Sending is not on the list, so it cannot happen here, whatever the model says or a later change forgets (R25.2). Every request goes
 * through `assertGmailDraftCallAllowed`; anything else throws before a network call is made. A separate test scans the whole source tree
 * for any other Gmail write endpoint or send-capable scope.
 */
const HOST = "gmail.googleapis.com";
const DRAFT_ID = "[A-Za-z0-9_-]{1,128}";
const ALLOWED: Array<{ method: string; path: RegExp }> = [
  { method: "POST", path: new RegExp("^/gmail/v1/users/me/drafts$") },
  { method: "GET", path: new RegExp(`^/gmail/v1/users/me/drafts/${DRAFT_ID}$`) },
  { method: "PUT", path: new RegExp(`^/gmail/v1/users/me/drafts/${DRAFT_ID}$`) },
  { method: "DELETE", path: new RegExp(`^/gmail/v1/users/me/drafts/${DRAFT_ID}$`) },
];

export class GmailCallNotAllowedError extends Error {}

export function assertGmailDraftCallAllowed(method: string, rawUrl: string) {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new GmailCallNotAllowedError("Not a valid URL"); }
  const okQuery = [...url.searchParams.keys()].every((key) => key === "format") && ["", "full", "raw", "minimal"].includes(url.searchParams.get("format") ?? "");
  const listed = url.protocol === "https:" && url.hostname === HOST && !url.username && !url.password && okQuery
    && ALLOWED.some((rule) => rule.method === method.toUpperCase() && rule.path.test(url.pathname));
  if (!listed) throw new GmailCallNotAllowedError(`Gmail call not allowed: ${method.toUpperCase()} ${url.pathname}`);
}

export type GmailDraftResource = {
  id: string;
  message?: {
    id?: string;
    threadId?: string;
    payload?: { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: Array<{ name: string; value: string }> };
  };
};
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };

export class GmailDraftMissingError extends Error {}

async function draftRequest<T>(userId: string, method: "POST" | "GET" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T | null> {
  const url = `https://${HOST}${path}`;
  assertGmailDraftCallAllowed(method, url);
  return withGoogleCredential(userId, "email_drafts", async (accessToken) => {
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    // The draft is gone: sent from Gmail, or deleted there.
    if (response.status === 404) throw new GmailDraftMissingError("draft not found");
    if (!response.ok) throw new Error(`GMAIL_DRAFT_${method}_${response.status}`);
    return method === "DELETE" ? null : await response.json() as T;
  });
}

type Raw = { raw: string; threadId?: string };

export const createGmailDraft = (userId: string, message: Raw) => draftRequest<GmailDraftResource>(userId, "POST", "/gmail/v1/users/me/drafts", { message }) as Promise<GmailDraftResource>;
export const getGmailDraft = (userId: string, id: string) => draftRequest<GmailDraftResource>(userId, "GET", `/gmail/v1/users/me/drafts/${encodeURIComponent(id)}?format=full`) as Promise<GmailDraftResource>;
export const updateGmailDraft = (userId: string, id: string, message: Raw) => draftRequest<GmailDraftResource>(userId, "PUT", `/gmail/v1/users/me/drafts/${encodeURIComponent(id)}`, { id, message }) as Promise<GmailDraftResource>;
export const deleteGmailDraft = async (userId: string, id: string) => { await draftRequest(userId, "DELETE", `/gmail/v1/users/me/drafts/${encodeURIComponent(id)}`); };

const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** The plain-text body of a draft as Gmail holds it now. */
export function draftBodyText(draft: GmailDraftResource): string {
  const walk = (part: GmailPart | undefined): string | null => {
    if (!part) return null;
    if (part.mimeType?.startsWith("text/plain") && part.body?.data) return decode(part.body.data);
    for (const child of part.parts ?? []) { const found = walk(child); if (found !== null) return found; }
    return null;
  };
  const payload = draft.message?.payload;
  return walk(payload) ?? (payload?.body?.data ? decode(payload.body.data) : "");
}
