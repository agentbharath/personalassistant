import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDecision } from "./router";

const mocks = vi.hoisted(() => ({
  route: vi.fn(), dispatch: vi.fn(), approval: vi.fn(), pending: vi.fn(), emailState: vi.fn(),
}));
vi.mock("./router-runtime", () => ({ routeForUser: mocks.route }));
vi.mock("./dispatch", () => ({ dispatchDecision: mocks.dispatch, answerApproval: mocks.approval, NOTHING_PENDING: "NOTHING PENDING" }));
vi.mock("@/lib/workflows/pending", () => ({ hasPendingApproval: mocks.pending }));
vi.mock("@/lib/conversations/email-state", () => ({ loadEmailState: mocks.emailState }));

import { CANNOT_INTERPRET, NOT_SURE, runOrchestrator } from "./run";

const decision = (over: Partial<RouterDecision> = {}): RouterDecision => ({ operation: "email", agents: [], sender: null, matter: null, merchant: null, paidOn: null, term: null, lesson: null, confidence: 0.95, clarification: null, reading: "", source: "model", ...over });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.pending.mockResolvedValue(false);
  mocks.emailState.mockResolvedValue(null);
});

describe("no rules interpret a message, ever (R20.5)", () => {
  it("says it cannot interpret requests, does nothing, and shows the fixed emergency line, when no model can be used", async () => {
    mocks.route.mockResolvedValue(null);
    const result = await runOrchestrator("show my receipts", "u1", [], "c1", "r1");
    expect(result).toMatchObject({ requestId: "r1", answer: CANNOT_INTERPRET, agents: [], status: "completed" });
    expect(result.answer).toMatch(/haven't done anything/);
    expect(result.answer).toMatch(/988/);
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
