import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => {
  const scope = { setLevel: vi.fn(), setFingerprint: vi.fn(), setTag: vi.fn(), setUser: vi.fn() };
  return { scope, captureException: vi.fn(), withScope: vi.fn((callback: (scope: unknown) => void) => callback(scope)) };
});
vi.mock("@sentry/nextjs", () => ({ withScope: sentry.withScope, captureException: sentry.captureException }));

import { describeError, logEvent, reportFailure, resetReportThrottleForTest } from "./report";

beforeEach(() => {
  resetReportThrottleForTest();
  sentry.captureException.mockClear();
  Object.values(sentry.scope).forEach((mock) => mock.mockClear());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

class GmailError extends Error { name = "GoogleGmailAccessError"; reason = "unavailable"; status = 429; }

describe("structured logging (free)", () => {
  it("writes the event name and a JSON object of plain fields", () => {
    logEvent("info", "provider_call", { provider: "google_gmail", status: 200 });
    expect(console.info).toHaveBeenCalledWith("provider_call", '{"provider":"google_gmail","status":200}');
  });

  it("describes an error by its type, status, code and reason, and never by its message", () => {
    expect(describeError(new GmailError("subject: Your lease for alice@example.com"))).toEqual({ errorName: "GoogleGmailAccessError", status: 429, reason: "unavailable" });
    expect(describeError("boom")).toEqual({ errorName: "string" });
    expect(describeError(null)).toEqual({ errorName: "object" });
  });
});

describe("reporting a handled failure (free)", () => {
  it("logs a line with the event and the safe error facts, without the message", () => {
    reportFailure("waiting_replies_failed", new GmailError("private text alice@example.com"), { provider: "google_gmail" });
    const line = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(line[0]).toBe("waiting_replies_failed");
    expect(line[1]).toContain('"errorName":"GoogleGmailAccessError"');
    expect(line[1]).not.toContain("alice@example.com");
  });

  it("sends Sentry an event grouped by what failed, with the message replaced", () => {
    reportFailure("waiting_replies_failed", new GmailError("private text alice@example.com"), { provider: "google_gmail" }, { userId: "u1" });
    expect(sentry.scope.setFingerprint).toHaveBeenCalledWith(["waiting_replies_failed", "GoogleGmailAccessError", "429"]);
    expect(sentry.scope.setTag).toHaveBeenCalledWith("provider", "google_gmail");
    expect(sentry.scope.setUser).toHaveBeenCalledWith({ id: "u1" });
    const sent = sentry.captureException.mock.calls[0][0] as Error;
    expect(sent.message).toBe("waiting_replies_failed: GoogleGmailAccessError 429");
    expect(sent.stack).not.toContain("alice@example.com");
  });

  it("sends one event per group per minute, but logs every time", () => {
    for (let i = 0; i < 5; i += 1) reportFailure("provider_call_failed", new GmailError("x"), { provider: "google_gmail" });
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(5);
    reportFailure("provider_call_failed", new GmailError("x"), { provider: "tavily" });
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it("uses the error level when asked and never throws, even if Sentry does", () => {
    reportFailure("chat_request_failed", new Error("x"), {}, { level: "error" });
    expect(console.error).toHaveBeenCalled();
    expect(sentry.scope.setLevel).toHaveBeenCalledWith("error");
    resetReportThrottleForTest();
    sentry.withScope.mockImplementationOnce(() => { throw new Error("sentry down"); });
    expect(() => reportFailure("x", new Error("y"))).not.toThrow();
  });
});
