import { createHash } from "node:crypto";
import { ProviderCircuitOpenError, resilientFetch } from "@/lib/runtime/resilient-fetch";
import { getRequestContext, remainingRequestMs } from "@/lib/runtime/request-context";
import { reportFailure } from "@/lib/observability/report";

export type GmailFailureReason = "api_disabled" | "insufficient_scope" | "forbidden" | "unavailable" | "rate_limited" | "quota_exceeded" | "not_found" | "invalid_request";
export class GoogleGmailAccessError extends Error {
  constructor(public readonly reason: GmailFailureReason, public readonly status?: number, public readonly retryAfterMs?: number) {
    super(`Google Gmail access failed: ${reason}`);
    this.name = "GoogleGmailAccessError";
  }
}

export function gmailFailureMessage(error: GoogleGmailAccessError) {
  switch (error.reason) {
    case "insufficient_scope": return "Google rejected Gmail access; reconnect Google if retrying does not restore it";
    case "api_disabled": return "the Gmail API is disabled for this Google project";
    case "forbidden": return "Google blocked Gmail access for this account";
    case "rate_limited": return "Gmail temporarily limited reads; retry after its cooldown";
    case "quota_exceeded": return "the Google project's Gmail quota has been reached";
    case "not_found": return "the message is no longer available in Gmail";
    case "invalid_request": return "Gmail rejected the read request (HTTP 400)";
    default: return error.status ? `Gmail returned HTTP ${error.status}` : "Gmail is temporarily unavailable";
  }
}

export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

type Pace = { nextAt: number; cooldownUntil: number };
const pacing = new Map<string, Pace>();

async function pause(ms: number, deadlineAt: number) {
  if (ms <= 0) return;
  const signal = getRequestContext()?.signal;
  if (signal?.aborted || Date.now() + ms >= deadlineAt || remainingRequestMs(ms + 1) <= ms) throw new DOMException("Gmail read budget ended", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Request cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Pace each credential independently and honor Google's throttling, including its 403 quota responses. */
export async function gmailFetch(url: URL, accessToken: string, deadlineAt = Infinity): Promise<Response> {
  // No credential or email text is stored in logs or pacing keys.
  const key = createHash("sha256").update(accessToken).digest("hex");
  const pace = pacing.get(key) ?? { nextAt: 0, cooldownUntil: 0 };
  if (!pacing.has(key) && pacing.size >= 1000) pacing.delete(pacing.keys().next().value as string);
  pacing.set(key, pace);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const at = Math.max(Date.now(), pace.nextAt, pace.cooldownUntil);
    pace.nextAt = at + 40; // At most 25 starts per second per credential, across simultaneous scans.
    await pause(at - Date.now(), deadlineAt);
    while (pace.cooldownUntil > Date.now()) {
      const wait = pace.cooldownUntil - Date.now();
      if (Date.now() + wait >= deadlineAt || remainingRequestMs(wait + 1) <= wait) throw new GoogleGmailAccessError("rate_limited", 429, wait);
      await pause(wait, deadlineAt);
    }
    if (Date.now() >= deadlineAt) throw new DOMException("Gmail scan deadline exceeded", "AbortError");
    let response: Response;
    try {
      response = await resilientFetch("google_gmail", url, { headers: { authorization: `Bearer ${accessToken}` } }, { timeoutMs: Math.max(1, Math.min(8000, deadlineAt - Date.now())), maxAttempts: 1, circuitKey: key });
    } catch (error) {
      if (error instanceof ProviderCircuitOpenError) throw new GoogleGmailAccessError("unavailable");
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (attempt === 2) throw error;
      await pause(1000 * 2 ** attempt, deadlineAt);
      continue;
    }
    if (response.ok) return response;
    const body = await response.json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null;
    const googleReason = body?.error?.errors?.[0]?.reason;
    const throttled = response.status === 429 || (response.status === 403 && ["rateLimitExceeded", "userRateLimitExceeded"].includes(googleReason ?? ""));
    const reason: GmailFailureReason = throttled ? "rate_limited"
      : response.status === 403 && googleReason === "dailyLimitExceeded" ? "quota_exceeded"
      : response.status === 403 && ["accessNotConfigured", "serviceDisabled"].includes(googleReason ?? "") ? "api_disabled"
      : response.status === 401 || (response.status === 403 && googleReason === "insufficientPermissions") ? "insufficient_scope"
      : response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : response.status === 400 ? "invalid_request" : "unavailable";
    const delay = Math.max(retryAfterMs(response.headers.get("retry-after")) ?? 0, 1000 * 2 ** attempt + Math.floor(Math.random() * 250));
    const error = new GoogleGmailAccessError(reason, response.status, throttled ? delay : undefined);
    if (throttled) pace.cooldownUntil = Math.max(pace.cooldownUntil, Date.now() + delay);
    if ((throttled || response.status >= 500) && attempt < 2 && Date.now() + delay < deadlineAt && remainingRequestMs(delay + 1000) > delay) {
      await pause(delay, deadlineAt);
      continue;
    }
    reportFailure("gmail_read_failed", error, { provider: "google_gmail", operation: "read" });
    throw error;
  }
  throw new GoogleGmailAccessError("unavailable");
}

export function resetGmailPacingForTest() { pacing.clear(); }
