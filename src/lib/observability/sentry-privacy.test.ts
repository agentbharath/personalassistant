import { describe, expect, it } from "vitest";
import { sanitizeSentryEvent, validOtlpEndpoint } from "./sentry-privacy";

describe("observability privacy", () => {
  it("removes payloads, credentials, network identifiers, and breadcrumb data", () => {
    const event = sanitizeSentryEvent({ type: undefined, request: { data: "secret", cookies: { session: "secret" }, headers: { authorization: "Bearer secret", cookie: "session=secret", "x-forwarded-for": "1.2.3.4", accept: "json" } }, user: { id: "opaque-user", email: "private@example.com" }, breadcrumbs: [{ message: "private prompt", data: { value: "secret" } }] }, {});
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.headers?.authorization).toBeUndefined();
    expect(event.request?.headers?.accept).toBe("json");
    expect(event.user).toEqual({ id: "opaque-user" });
    expect(event.breadcrumbs?.[0].message).toBeUndefined();
  });

  it("does not enable OTLP for placeholder or insecure endpoints", () => {
    expect(validOtlpEndpoint("https://otlp-<region>.example.com")).toBe(false);
    expect(validOtlpEndpoint("http://localhost:4318")).toBe(false);
    expect(validOtlpEndpoint("https://otlp.example.com")).toBe(true);
  });
});
