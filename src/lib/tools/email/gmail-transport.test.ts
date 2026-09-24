import { afterEach, expect, it, vi } from "vitest";
import { gmailFetch, resetGmailPacingForTest, retryAfterMs } from "./gmail-transport";
import { resetProviderCircuitsForTest } from "@/lib/runtime/resilient-fetch";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetGmailPacingForTest(); resetProviderCircuitsForTest(); });
const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");

it("honors Retry-After for Gmail's 403 rate limits", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, { status: 403, headers: { "Retry-After": "3" } })).mockResolvedValueOnce(Response.json({ messages: [] }));
  vi.stubGlobal("fetch", fetcher);
  const result = gmailFetch(url, "token");
  await vi.advanceTimersByTimeAsync(2999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await result).ok).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("returns a quota error without retrying a permanent daily quota rejection", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { errors: [{ reason: "dailyLimitExceeded" }] } }, { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(gmailFetch(url, "token")).rejects.toMatchObject({ reason: "quota_exceeded", status: 403 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reports throttling when its cooldown exceeds the scan deadline", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 429, headers: { "Retry-After": "60" } })));
  await expect(gmailFetch(url, "token", Date.now() + 1000)).rejects.toMatchObject({ reason: "rate_limited", retryAfterMs: 60000 });
});

it("parses both Retry-After formats", () => {
  expect(retryAfterMs("2")).toBe(2000);
  expect(retryAfterMs("Sun, 20 Sep 2026 12:00:03 GMT", Date.parse("2026-09-20T12:00:00Z"))).toBe(3000);
  expect(retryAfterMs("invalid")).toBeNull();
});
