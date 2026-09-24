import { expect, it, vi } from "vitest";
import { digestDate, digestParameters, sendDigest, DigestRejected, singleLine } from "./whatsapp";
import type { DaySummary } from "@/lib/today/summary";
it.each([["2026-01-15T15:00:00Z", "2026-01-15"], ["2026-07-15T14:00:00Z", "2026-07-15"], ["2026-03-08T14:00:00Z", "2026-03-08"], ["2026-11-01T15:00:00Z", "2026-11-01"], ["2026-01-15T14:00:00Z", null], ["2026-07-15T15:00:00Z", null]])("uses 7 AM LA at %s", (time, date) => expect(digestDate(new Date(time))).toBe(date));
it("keeps incomplete replies truthful and respects hidden categories", () => {
 const summary = {view: {meetingsToday: {state: "ok", value: []}}, replies: {state: "ok", checked: 1, total: 3, prefs: {kinds: ["person"]}, items: [{from: "Alex\nSmith <alex@example.com>", kind: "person"}, {from: "Hidden", kind: "action"}]}} as unknown as DaySummary;
 const params = digestParameters(summary, "https://example.com");
 expect(params).toEqual(["0 calendar events", "So far, 1 email may need your reply.", "Including Alex Smith.", "https://example.com/perch"]);
});
it("does not claim no emails need a reply when the service is unavailable", () => {
 const summary = {view: {meetingsToday: {state: "unavailable"}}, replies: {state: "unavailable"}} as DaySummary;
 expect(digestParameters(summary, "https://example.com")[1]).toBe("Reply reminders could not be checked.");
});
it("sanitizes newlines and tabs in template parameters", () => expect(singleLine("A\nB\t C")).toBe("A B C"));
const config = {userId: "u", token: "test-token", phoneId: "123", recipient: "15555551234", version: "v25.0", origin: "https://example.com", template: "daily_digest"};
it("sends the approved template once without a free-form message", async () => {
 const send = vi.fn().mockResolvedValue({ok: true, json: async () => ({messages: [{id: "message"}]})});
 expect(await sendDigest(config, ["a", "b", "c", "d"], send)).toBe("message");
 const body = JSON.parse(send.mock.calls[0][1].body);
 expect(body.type).toBe("template"); expect(body.template.components[0].parameters).toHaveLength(4);
 expect(send).toHaveBeenCalledTimes(1);
});
it("does not retry a delivery with an ambiguous timeout", async () => {
 const send = vi.fn().mockRejectedValue(new Error("timeout"));
 await expect(sendDigest(config, ["a"], send)).rejects.toThrow("timeout");
 expect(send).toHaveBeenCalledTimes(1);
});
it("distinguishes a provider rejection from unknown delivery", async () => {
 const send = vi.fn().mockResolvedValue({ok: false, status: 400});
 await expect(sendDigest(config, ["a"], send)).rejects.toBeInstanceOf(DigestRejected);
});
