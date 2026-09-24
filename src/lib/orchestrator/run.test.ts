import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDecision } from "./router";

const mocks = vi.hoisted(() => ({
  history: vi.fn(), recalled: vi.fn(), resume: vi.fn(), route: vi.fn(), dispatch: vi.fn(), approval: vi.fn(), pending: vi.fn(), emailState: vi.fn(),
}));
vi.mock("@/lib/conversations/history", () => ({ recallConversation: mocks.history }));
vi.mock("@/lib/agents/email-finance-import", () => ({continueEmailFinanceImport: mocks.resume}));
vi.mock("@/lib/conversations/search-state", async original => ({ ...await original<typeof import("@/lib/conversations/search-state")>(), loadRecentSearchStates: mocks.recalled, loadSearchState: vi.fn(async () => null) }));
vi.mock("./router-runtime", () => ({ routeForUser: mocks.route }));
vi.mock("./dispatch", () => ({ dispatchDecision: mocks.dispatch, answerApproval: mocks.approval, NOTHING_PENDING: "NOTHING PENDING" }));
vi.mock("@/lib/workflows/pending", () => ({ hasPendingApproval: mocks.pending }));
vi.mock("@/lib/conversations/email-state", () => ({ loadEmailState: mocks.emailState }));

import { CANNOT_INTERPRET, NOT_SURE, runOrchestrator } from "./run";

const decision = (over: Partial<RouterDecision> = {}): RouterDecision => ({ operation: "email", agents: [], sender: null, matter: null, merchant: null, paidOn: null, term: null, lesson: null, confidence: 0.95, clarification: null, reading: "", source: "model", ...over });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.recalled.mockResolvedValue([]);
  mocks.pending.mockResolvedValue(false);
  mocks.emailState.mockResolvedValue(null);
});

describe("no rules interpret a message, ever (R20.5)", () => {
  it("reports model unavailability without inferring a crisis", async () => {
    mocks.route.mockResolvedValue(null);
    const result = await runOrchestrator("show my receipts", "u1", [], "c1", "r1");
    expect(result).toMatchObject({ requestId: "r1", answer: CANNOT_INTERPRET, agents: [], status: "completed" });
    expect(result.answer).toMatch(/saved work is unchanged/);
    expect(result.answer).not.toMatch(/988|emergency|danger/);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("shows the same message for a message that would once have matched a rule (a crisis, a greeting, a search)", async () => {
    mocks.route.mockResolvedValue(null);
    for (const message of ["hi", "i don't want to be here anymore", "all iherb receipts", "delete the adobe invoice email"]) {
      expect((await runOrchestrator(message, "u1", [], "c1")).answer).toBe(CANNOT_INTERPRET);
    }
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("asks instead of guessing when the model's specialist could not settle on a reading", async () => {
    mocks.route.mockResolvedValue(decision());
    mocks.dispatch.mockResolvedValue(null);
    expect(await runOrchestrator("something odd", "u1", [], "c1")).toMatchObject({ answer: NOT_SURE, status: "waiting_for_user" });
  });

  it("returns what dispatch produced when the model read the message", async () => {
    const routed = decision({ operation: "finance_spending" });
    mocks.route.mockResolvedValue(routed);
    mocks.dispatch.mockResolvedValue({ requestId: "r1", answer: "FINANCE", agents: ["finance"], confidence: 0.95, status: "completed" });
    expect((await runOrchestrator("how much have i spent", "u1", [], "c1", "r1")).answer).toBe("FINANCE");
    expect(mocks.dispatch).toHaveBeenCalledWith(routed, expect.objectContaining({ userId: "u1", input: "how much have i spent", conversationId: "c1" }));
  });

  it("gives the router the pending-approval flag, today's date and the saved email search, and nothing else decides", async () => {
    mocks.route.mockResolvedValue(null);
    mocks.pending.mockResolvedValue(true);
    mocks.emailState.mockResolvedValue({ request: { topic: "receipt" }, results: [], updatedAt: 1 });
    await runOrchestrator("yes", "u1", [{ role: "assistant", content: "Confirm?" }], "c1");
    expect(mocks.route.mock.calls[0][0]).toMatchObject({ userId: "u1", message: "yes", pendingApproval: true, emailState: { request: { topic: "receipt" } } });
    expect(mocks.route.mock.calls[0][0].today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the Confirm and Cancel buttons need no model (R20.5)", () => {
  it("confirm resolves the pending approval without asking the router, so it works when the model is down", async () => {
    mocks.route.mockResolvedValue(null);
    mocks.approval.mockResolvedValue({ answer: "Saved.", agents: ["calendar"], status: "completed" });
    const result = await runOrchestrator("confirm", "u1", [], "c1", "r1", "confirm");
    expect(mocks.approval).toHaveBeenCalledWith(true, "u1", "c1");
    expect(mocks.route).not.toHaveBeenCalled();
    expect(result).toMatchObject({ answer: "Saved.", agents: ["calendar"], status: "completed" });
  });

  it("cancel does the same, and says so when nothing is waiting", async () => {
    mocks.approval.mockResolvedValue(null);
    const result = await runOrchestrator("cancel", "u1", [], "c1", "r1", "cancel");
    expect(mocks.approval).toHaveBeenCalledWith(false, "u1", "c1");
    expect(result.answer).toBe("NOTHING PENDING");
  });

  it("typed words are never treated as a button: only the explicit action is", async () => {
    mocks.route.mockResolvedValue(null);
    expect((await runOrchestrator("confirm", "u1", [], "c1")).answer).toBe(CANNOT_INTERPRET);
    expect(mocks.approval).not.toHaveBeenCalled();
  });
});

it("Continue scan is a distinct interface action and never approves an import", async () => {
  mocks.resume.mockResolvedValue("Scan resumed");
  expect(await runOrchestrator("Continue scan", "u", [], "c", "r", "continue_scan")).toMatchObject({answer:"Scan resumed",status:"waiting_for_user"});
  expect(mocks.resume).toHaveBeenCalledWith("u","c");
  expect(mocks.approval).not.toHaveBeenCalled();
  expect(mocks.route).not.toHaveBeenCalled();
});

it("passes dated cross-conversation search recall to both routing and answering", async () => {
  mocks.recalled.mockResolvedValue([{ query: "Chinese restaurants Sunnyvale", updatedAt: Date.now() - 86400000, places: [{ name: "Ginger Cafe", address: "Sunnyvale", note: "Previously shown" }] }]);
  mocks.route.mockResolvedValue(decision({ operation: "general_answer" }));
  mocks.dispatch.mockResolvedValue({ answer: "Ginger Cafe", agents: [], status: "completed" });
  const context = [{ role: "user" as const, content: "Do you remember the Chinese restaurants from yesterday?" }];
  await runOrchestrator("Tell me what you remember about them", "u1", context, "c1");
  expect(JSON.stringify(mocks.route.mock.calls[0][0].context)).toContain("Ginger Cafe");
  expect(JSON.stringify(mocks.dispatch.mock.calls[0][1].context)).toContain("Ginger Cafe");
  expect(mocks.dispatch.mock.calls[0][1].context.at(-1)).toEqual(context[0]);
});

it("skips cross-conversation search recall once a conversation has built up its own real context, so it can't dilute an unrelated multi-turn task", async () => {
  mocks.recalled.mockResolvedValue([{ query: "Chinese restaurants Sunnyvale", updatedAt: Date.now() - 86400000, places: [{ name: "Ginger Cafe", address: "Sunnyvale", note: "Previously shown" }] }]);
  mocks.route.mockResolvedValue(decision({ operation: "web_search", searchQuery: "shopping in Colorado" }));
  mocks.dispatch.mockResolvedValue({ answer: "shopping ideas", agents: [], status: "completed" });
  const context = [
    { role: "user" as const, content: "plan a trip to Colorado for Thanksgiving" },
    { role: "assistant" as const, content: "Here are some Thanksgiving activities in Colorado..." },
    { role: "user" as const, content: "what kind of shopping should I do for my november trip" },
    { role: "assistant" as const, content: "Shopping for the trip itself, or activities while there?" },
    { role: "user" as const, content: "for the trip" },
  ];
  await runOrchestrator("for the trip", "u1", context, "c1");
  expect(JSON.stringify(mocks.route.mock.calls[0][0].context)).not.toContain("Ginger Cafe");
  expect(JSON.stringify(mocks.route.mock.calls[0][0].context)).not.toContain("Earlier conversation summary");
});

it.each(["calendar meeting", "resume draft", "personal preferences", "restaurant list"])("retrieves older %s before answering or dispatching a resolved follow-up", async topic => {
 mocks.route.mockResolvedValueOnce(decision({operation: "clarify", historyQuery: topic})).mockResolvedValueOnce(decision({operation: "general_answer", resolvedInput: `Explain the earlier ${topic}`}));
 mocks.history.mockResolvedValue({text: `Original details about ${topic}`, references: []});
 mocks.dispatch.mockResolvedValue({answer: "Remembered", agents: [], status: "completed"});
 await runOrchestrator("Tell me more about that", "u1", [], "c1");
 expect(mocks.history).toHaveBeenCalledWith("u1", "c1", topic, []);
 expect(mocks.route).toHaveBeenCalledTimes(2);
 expect(mocks.dispatch).toHaveBeenCalledTimes(1);
 expect(mocks.dispatch.mock.calls[0][1].input).toBe(`Explain the earlier ${topic}`);
 expect(JSON.stringify(mocks.dispatch.mock.calls[0][1].context)).toContain(`Original details about ${topic}`);
 expect(mocks.approval).not.toHaveBeenCalled();
});

it("never dispatches or approves an action when context repair remains blocked", async () => {
  mocks.pending.mockResolvedValue(true);
  mocks.route.mockResolvedValue(decision({operation:"clarify", continuityBlocked:true, clarification:"Your reply is saved, but I couldn't connect it reliably."}));
  const result = await runOrchestrator("Daylark drafts", "u1", [], "c1");
  expect(result.status).toBe("partially_completed");
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.approval).not.toHaveBeenCalled();
});
