import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ select: vi.fn(), search: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("./email-result-selection", () => ({ selectEmailResults: mocks.select, EmailSelectionUnavailable: class extends Error {} }));
vi.mock("@/lib/tools/email/google-gmail", () => ({ searchGmail: mocks.search, readGmailMessage: mocks.read, readGmailAttachment: vi.fn(), GoogleGmailAccessError: class extends Error {} }));
vi.mock("@/lib/conversations/email-state", () => ({ saveEmailState: mocks.save }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: async () => NO_LEARNINGS }));
vi.mock("@/lib/model/claude", () => ({ composeNoResultReply: async () => "No matching maintenance email found.", extractTransactionFromEvidence: vi.fn() }));
import { NO_LEARNINGS } from "@/lib/learning/learnings";
import { searchEmail } from "./email";
import { renderEmailRequest, type EmailRequest } from "./email-request";
const request: EmailRequest = { action: "list", topic: "general", sender: null, days: 30, calendar: null, unread: false, humansOnly: false, exclusion: "", searchTerms: ["maintenance", "work order", "repair request", "service request"] };
const mail = (id: string, subject: string, snippet: string) => ({ id, threadId: id, subject, snippet, from: "Heritage Park Apartments <no-reply@rentcafe.com>", date: new Date().toISOString(), receivedAt: Date.now() });
beforeEach(() => { mocks.select.mockImplementation(async (_u, _r, candidates) => candidates.filter((candidate: { id: string }) => candidate.id !== "ad")); mocks.search.mockReset(); mocks.read.mockReset(); mocks.read.mockResolvedValue({ text: "Unrelated mail" }); });
it("preserves maintenance scope and returns the attached work-order example without generic suggestions", async () => {
  mocks.search.mockResolvedValue([mail("maintenance", "Work Order Pending Review", "We have just received your work order request. It is currently pending review."), mail("ad", "Don’t miss your slice of the savings", "Make a wish before these deals are gone")]);
  const result = await searchEmail(renderEmailRequest(request), "u", { request });
  expect(mocks.search.mock.calls[0][1]).toContain('{"maintenance" "work order" "repair request" "service request"}');
  expect(mocks.search.mock.calls[0][1]).not.toContain("subject:receipt");
  expect(result.results.map(item => item.id)).toEqual(["maintenance"]);
  expect(result.answer).toContain("Work Order Pending Review");
  expect(result.answer).not.toMatch(/slice of the savings|all email|Not what you meant|always search/);
});
it("checks body-only Gmail matches instead of displaying unrelated results", async () => {
  mocks.search.mockResolvedValue([mail("body", "An update on your request", "Hello Bharath")]);
  mocks.read.mockResolvedValue({ text: "Your maintenance request is pending review." });
  expect((await searchEmail(renderEmailRequest(request), "u", { request })).results[0]?.id).toBe("body");
});
it("does not replace an empty topic search with unrelated inbox messages", async () => {
  mocks.search.mockResolvedValue([mail("ad", "Movie night", "Enjoy the show")]);
  expect((await searchEmail(renderEmailRequest(request), "u", { request })).results).toEqual([]);
  expect(mocks.search.mock.calls.every(call => call[1].includes('"work order"'))).toBe(true);
});
it("shows the next matching page and saves ordinals for that page", async () => {
  mocks.search.mockResolvedValue(Array.from({ length: 8 }, (_, index) => mail(String(index), `Maintenance update ${index}`, "Work order status")));
  const result = await searchEmail("show more", "u", { request: { ...request, offset: 5 }, conversationId: "c" });
  expect(result.results.map(item => item.id)).toEqual(["5", "6", "7"]);
  expect(result.answer).toContain("Showing 6–8 of 8");
  expect(mocks.save.mock.calls.at(-1)?.[2].results[0].id).toBe("5");
});
