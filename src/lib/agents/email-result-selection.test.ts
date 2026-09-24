import { beforeEach, expect, it, vi } from "vitest";
const complete = vi.hoisted(() => vi.fn());
vi.mock("@/lib/runtime/model-runtime", () => ({ callClaude: complete }));
vi.mock("@/lib/runtime/encrypted-cache", () => ({ createEncryptedCache: () => ({ get: async () => null, set: async () => {} }) }));
import { selectEmailResults, EmailSelectionUnavailable } from "./email-result-selection";
import type { EmailRequest } from "./email-request";
const request: EmailRequest = { action: "list", topic: "general", sender: null, days: 30, calendar: null, unread: false, humansOnly: false, exclusion: "", searchTerms: ["maintenance"] };
const candidates = [{ id: "work", threadId: "work", from: "Heritage Park", subject: "Work Order Pending Review", snippet: "Your request is pending review", date: "2026-09-21", receivedAt: 1 }];
beforeEach(() => { complete.mockReset(); });
it("preserves semantic matches without requiring a keyword match", async () => {
 complete.mockResolvedValue({ content: [{ type: "text", text: '{"ids":["work"]}' }] });
 expect(await selectEmailResults("u", request, candidates)).toEqual(candidates);
 expect(complete.mock.calls[0][1].messages[0].content).toContain("Work Order Pending Review");
});
it("rejects invented IDs instead of presenting unverified results", async () => {
 complete.mockResolvedValue({ content: [{ type: "text", text: '{"ids":["made-up"]}' }] });
 await expect(selectEmailResults("u", request, candidates)).rejects.toBeInstanceOf(EmailSelectionUnavailable);
});
it("does not replace model unavailability with arbitrary inbox results", async () => {
 complete.mockRejectedValue(new Error("offline"));
 await expect(selectEmailResults("u", request, candidates)).rejects.toBeInstanceOf(EmailSelectionUnavailable);
});
it("reviews larger result sets in bounded batches without losing later candidates", async () => {
 complete.mockImplementation(async (_purpose, params) => ({ content: [{ type: "text", text: JSON.stringify({ ids: JSON.parse(params.messages[0].content).candidates.map((mail: { id: string }) => mail.id) }) }] }));
 const many = Array.from({ length: 120 }, (_, index) => ({ ...candidates[0], id: String(index) }));
 expect(await selectEmailResults("u", request, many)).toHaveLength(120);
 expect(complete.mock.calls.map(call => JSON.parse(call[1].messages[0].content).candidates.length)).toEqual([50, 50, 20]);
});
it("passes the full home-maintenance intent and excludes the model-rejected bank notice", async () => {
 complete.mockResolvedValue({ content: [{ type: "text", text: '{"ids":["work"]}' }] });
 const bank = { ...candidates[0], id: "bank", from: "YES BANK", subject: "Scheduled Maintenance Activity", snippet: "Digital banking systems maintenance" };
 const result = await selectEmailResults("u", { ...request, intent: "Have I received any mail for my home maintenance update" }, [...candidates, bank]);
 expect(result.map(mail => mail.id)).toEqual(["work"]);
 const params = complete.mock.calls[0][1];
 expect(JSON.parse(params.messages[0].content).request.intent).toContain("home maintenance");
 expect(params.system).toContain("takes precedence over broad searchTerms");
});
