import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "../../runtime/resilient-fetch";

vi.mock("../../auth/google-credential-broker", () => ({
  withGoogleCredential: vi.fn(async (_userId: string, capability: string, operation: (token: string) => Promise<unknown>) => {
    if (capability !== "calendar") throw new Error("wrong capability");
    return operation("calendar-token");
  }),
}));

import { createCalendarEvent, deleteApprovedCalendarEvent, updateCalendarEventAttendees } from "./google-calendar";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); });

describe("Google Calendar provider contract", () => {
  it("creates an event with a deterministic ID, timezone, and guest notifications", async () => {
    const providerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "google-id" }), { status: 200 }));
    vi.stubGlobal("fetch", providerFetch);
    const candidate = { summary: "Concert", start: "2026-11-08T02:00:00Z", end: "2026-11-08T04:00:00Z", timeZone: "America/Chicago", location: "Arlington", attendees: ["guest@example.com"] };
    await createCalendarEvent("00000000-0000-0000-0000-000000000001", candidate);
    const [url, init] = providerFetch.mock.calls[0] as [URL, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url.searchParams.get("sendUpdates")).toBe("all");
    expect(body.id).toMatch(/^[a-f0-9]{32}$/);
    expect(body.start.timeZone).toBe("America/Chicago");
    expect(body.attendees).toEqual([{ email: "guest@example.com" }]);
  });

  it("patches only attendees and treats missing deletion targets as idempotent", async () => {
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "event-id" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", providerFetch);
    await updateCalendarEventAttendees("user", "event-id", ["new@example.com"]);
    const [, patchInit] = providerFetch.mock.calls[0] as [URL, RequestInit];
    expect(patchInit.method).toBe("PATCH");
    expect(JSON.parse(patchInit.body as string)).toEqual({ attendees: [{ email: "new@example.com" }] });
    await expect(deleteApprovedCalendarEvent("user", "event-id")).resolves.toEqual({ alreadyDeleted: true });
  });
});
