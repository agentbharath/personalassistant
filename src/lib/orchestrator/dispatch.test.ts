import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Learning } from "@/lib/learning/learnings";
import type { RouterDecision } from "./router";

const mocks = vi.hoisted(() => ({
  answerCalendar: vi.fn(), prepareCalendarCreate: vi.fn(), answerFinance: vi.fn(), answerPublicSearch: vi.fn(), runBillsCommand: vi.fn(), answerStatusLookup: vi.fn(),
  answerCasual: vi.fn(), prepareCalendarAttendeeUpdate: vi.fn(), prepareCalendarDelete: vi.fn(), handleEmailConversationTurn: vi.fn(), answerScheduleFeasibility: vi.fn(), answerDailyView: vi.fn(), saveSearchState: vi.fn(),
  runLearningCommand: vi.fn(), executeReadOnlyAgentPlan: vi.fn(), saveLearning: vi.fn(),
  resolveDelete: vi.fn(), resolveAttendees: vi.fn(), resolveCreate: vi.fn(), resolveFinance: vi.fn(),
}));
vi.mock("@/lib/agents/calendar", () => ({ answerCalendar: mocks.answerCalendar }));
vi.mock("@/lib/agents/calendar-create", () => ({ prepareCalendarCreate: mocks.prepareCalendarCreate }));
vi.mock("@/lib/agents/finance", () => ({ answerFinance: mocks.answerFinance }));
vi.mock("@/lib/agents/general", () => ({ answerPublicSearch: mocks.answerPublicSearch }));
vi.mock("@/lib/agents/bills-agent", () => ({ runBillsCommand: mocks.runBillsCommand }));
vi.mock("@/lib/agents/status-lookup", () => ({ answerStatusLookup: mocks.answerStatusLookup }));
vi.mock("@/lib/learning/store", () => ({ saveLearning: mocks.saveLearning }));
vi.mock("@/lib/model/claude", () => ({ answerCasual: mocks.answerCasual }));
vi.mock("@/lib/runtime/query-budget", () => ({ prepareAgentStage: () => undefined }));
vi.mock("@/lib/workflows/calendar-create", () => ({
  prepareCalendarAttendeeUpdate: mocks.prepareCalendarAttendeeUpdate, prepareCalendarDelete: mocks.prepareCalendarDelete,
  resolvePendingCalendarDelete: mocks.resolveDelete, resolvePendingCalendarAttendeeUpdate: mocks.resolveAttendees, resolvePendingCalendarCreate: mocks.resolveCreate,
}));
vi.mock("@/lib/workflows/finance-import", () => ({ resolvePendingFinanceImport: mocks.resolveFinance }));
vi.mock("./email-turn", () => ({ handleEmailConversationTurn: mocks.handleEmailConversationTurn }));
vi.mock("@/lib/today/answer", () => ({ answerDailyView: mocks.answerDailyView }));
vi.mock("./feasibility", () => ({ answerScheduleFeasibility: mocks.answerScheduleFeasibility }));
vi.mock("./learning-turn", () => ({ runLearningCommand: mocks.runLearningCommand }));
vi.mock("./multi-agent", () => ({ composeMultiAgentAnswer: () => "COMPOSED", executeReadOnlyAgentPlan: mocks.executeReadOnlyAgentPlan, planClauseInstructions: () => ({ tasks: [], notes: [] }) }));

import { dispatchDecision } from "./dispatch";
import { CRISIS_RESPONSE } from "./scope";
import { UNSAFE_REFUSAL } from "./safety";

const decision = (over: Partial<RouterDecision>): RouterDecision => ({ operation: "email", agents: [], sender: null, matter: null, merchant: null, paidOn: null, term: null, lesson: null, confidence: 1, clarification: null, reading: "", source: "model", ...over });
const ctx = { requestId: "r1", input: "the message", userId: "u1", context: [], conversationId: "c1" };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.answerFinance.mockResolvedValue("FINANCE"); mocks.runBillsCommand.mockResolvedValue("BILLS"); mocks.answerDailyView.mockResolvedValue("DAILY"); mocks.answerStatusLookup.mockResolvedValue("STATUS");
  mocks.answerCalendar.mockResolvedValue("CALENDAR"); mocks.answerPublicSearch.mockResolvedValue("WEB"); mocks.answerCasual.mockResolvedValue("CASUAL");
  mocks.prepareCalendarCreate.mockResolvedValue("CREATE"); mocks.prepareCalendarDelete.mockResolvedValue("DELETE"); mocks.prepareCalendarAttendeeUpdate.mockResolvedValue("ATTENDEES");
  mocks.runLearningCommand.mockResolvedValue({ answer: "LEARNING", agents: [], status: "completed" }); mocks.executeReadOnlyAgentPlan.mockResolvedValue([{ agent: "email", ok: true, answer: "x" }]);
  mocks.saveLearning.mockResolvedValue(undefined);
  for (const resolver of [mocks.resolveDelete, mocks.resolveAttendees, mocks.resolveCreate, mocks.resolveFinance]) resolver.mockResolvedValue(null);
});

vi.mock("@/lib/conversations/search-state", () => ({ saveSearchState: (...args: unknown[]) => mocks.saveSearchState(...args) }));

describe("a web search uses the search the router wrote (free)", () => {
  it("saves what the search showed in this conversation, so a follow-up can point at it", async () => {
    await dispatchDecision(decision({ operation: "web_search", searchQuery: "q" } as never), ctx);
    const remember = mocks.answerPublicSearch.mock.calls[0][1] as (state: unknown) => Promise<void>;
    await remember({ query: "q", places: [{ name: "A", address: "", note: "" }] });
    expect(mocks.saveSearchState).toHaveBeenCalledWith("u1", "c1", { query: "q", places: [{ name: "A", address: "", note: "" }] });
  });
  it("passes the router's query, so the saved home place is in it", async () => {
    await dispatchDecision(decision({ operation: "web_search", searchQuery: "Indian restaurants in Sunnyvale, CA" } as never), ctx);
    expect(mocks.answerPublicSearch).toHaveBeenCalledWith("Indian restaurants in Sunnyvale, CA", expect.any(Function));
  });
  it("falls back to the person's own words when the router wrote none", async () => {
    await dispatchDecision(decision({ operation: "web_search" }), ctx);
    expect(mocks.answerPublicSearch).toHaveBeenCalledWith("the message", expect.any(Function));
  });
});

describe("each operation calls its own handler (R19.4)", () => {
  it.each([
    [decision({ operation: "finance_spending" }), () => mocks.answerFinance, "FINANCE"],
    [decision({ operation: "finance_record" }), () => mocks.answerFinance, "FINANCE"],
    [decision({ operation: "bills_list" }), () => mocks.runBillsCommand, "BILLS"],
    [decision({ operation: "daily_view" }), () => mocks.answerDailyView, "DAILY"],
    [decision({ operation: "calendar_query" }), () => mocks.answerCalendar, "CALENDAR"],
    [decision({ operation: "web_search" }), () => mocks.answerPublicSearch, "WEB"],
    [decision({ operation: "unsupported" }), () => mocks.answerCasual, "CASUAL"],
  ])("%#", async (d, handler, answer) => {
    const result = await dispatchDecision(d, ctx);
    expect(handler()).toHaveBeenCalled();
    expect(result?.answer).toBe(answer);
  });
  it("passes the model's structured arguments, including its own date reading", async () => {
    await dispatchDecision(decision({ operation: "bills_paid", merchant: "PG&E", paidOn: "2026-09-20" }), ctx);
    expect(mocks.runBillsCommand).toHaveBeenCalledWith({ type: "paid", merchant: "PG&E", paidOn: "2026-09-20" }, "u1");
    await dispatchDecision(decision({ operation: "bills_autopay", merchant: "PG&E" }), ctx);
    expect(mocks.runBillsCommand).toHaveBeenLastCalledWith({ type: "autopay", merchant: "PG&E" }, "u1");
    await dispatchDecision(decision({ operation: "status_lookup", sender: "chase", matter: "dispute" }), ctx);
    expect(mocks.answerStatusLookup).toHaveBeenCalledWith("u1", { sender: "chase", matter: "dispute" });
  });
  it("the email operation goes to the email specialist, and asks when it declines", async () => {
    mocks.handleEmailConversationTurn.mockResolvedValueOnce({ answer: "EMAIL", agents: ["email"], status: "completed" }).mockResolvedValueOnce(null);
    expect((await dispatchDecision(decision({ operation: "email" }), ctx))?.answer).toBe("EMAIL");
    expect(mocks.handleEmailConversationTurn).toHaveBeenCalledWith("the message", "u1", "c1", []);
    expect(await dispatchDecision(decision({ operation: "email" }), ctx)).toBeNull();
  });
  it("email writes are declined, and pending-approval operations need a saved conversation", async () => {
    expect((await dispatchDecision(decision({ operation: "email_write_declined" }), ctx))?.answer).toMatch(/read-only/);
    expect((await dispatchDecision(decision({ operation: "calendar_delete" }), { ...ctx, conversationId: undefined }))?.status).toBe("waiting_for_user");
    expect(mocks.prepareCalendarDelete).not.toHaveBeenCalled();
  });
  it("runs a multi-agent plan", async () => {
    const result = await dispatchDecision(decision({ operation: "multi", agents: ["calendar", "email"] }), ctx);
    expect(result?.answer).toContain("COMPOSED");
    expect(result?.agents).toEqual(["calendar", "email"]);
  });
});

describe("what the user taught is saved as the model read it (R14, R11.8)", () => {
  it.each([
    [{ kind: "merchant_category", merchant: "iherb", category: "health" }, { kind: "merchant_category", merchant: "iherb", category: "health" }],
    [{ kind: "receipts_show_amounts" }, { kind: "default_action", topic: "receipt", action: "amounts" }],
    [{ kind: "default_window", topic: "receipt", days: 90 }, { kind: "default_window", topic: "receipt", days: 90 }],
    [{ kind: "calendar_buffer", minutes: 20 }, { kind: "calendar_buffer", minutes: 20 }],
    [{ kind: "autopay", merchant: "PG&E" }, { kind: "autopay", merchant: "PG&E" }],
    [{ kind: "sender_alias", alias: "adobee", canonical: "Adobe" }, { kind: "sender_alias", alias: "adobee", canonical: "Adobe" }],
  ] as Array<[NonNullable<RouterDecision["lesson"]>, Learning]>)("%#", async (lesson, learning) => {
    const result = await dispatchDecision(decision({ operation: "learning_teach", lesson }), ctx);
    expect(mocks.saveLearning).toHaveBeenCalledWith("u1", learning);
    expect(result?.answer).toMatch(/^(Done|Got it)/);
  });
  it("says so when it could not save", async () => {
    mocks.saveLearning.mockRejectedValueOnce(new Error("db"));
    expect((await dispatchDecision(decision({ operation: "learning_teach", lesson: { kind: "receipts_show_amounts" } }), ctx))?.answer).toMatch(/couldn't save/);
  });
});

describe("forgetting (R15)", () => {
  it("forgets one thing at once", async () => {
    await dispatchDecision(decision({ operation: "learning_forget", term: "adobee" }), ctx);
    expect(mocks.runLearningCommand).toHaveBeenCalledWith({ type: "forget", term: "adobee" }, "u1");
  });
  it("asks before forgetting everything, and only deletes after Daylark had asked", async () => {
    await dispatchDecision(decision({ operation: "learning_forget", term: null }), ctx);
    expect(mocks.runLearningCommand).toHaveBeenLastCalledWith({ type: "forget_all" }, "u1");
    await dispatchDecision(decision({ operation: "learning_forget", term: "everything" }), { ...ctx, context: [{ role: "assistant", content: "That would clear 3 things. Nothing has changed yet. Say “yes, forget everything” to confirm." }] });
    expect(mocks.runLearningCommand).toHaveBeenLastCalledWith({ type: "confirm_forget_all" }, "u1");
  });
});

describe("approvals, safety (R19.4)", () => {
  it("approve and deny go to whichever approval is waiting, in the model's words, not the user's", async () => {
    mocks.resolveFinance.mockResolvedValueOnce({ answer: "IMPORTED", status: "completed" });
    const yes = await dispatchDecision(decision({ operation: "approve" }), ctx);
    expect(mocks.resolveFinance).toHaveBeenCalledWith("u1", "c1", "confirm");
    expect(yes).toMatchObject({ answer: "IMPORTED", agents: ["finance"] });
    mocks.resolveCreate.mockResolvedValueOnce({ answer: "CANCELLED", status: "completed" });
    await dispatchDecision(decision({ operation: "deny" }), ctx);
    expect(mocks.resolveCreate).toHaveBeenCalledWith("u1", "c1", "cancel");
  });
  it("says so when nothing is waiting", async () => {
    expect((await dispatchDecision(decision({ operation: "approve" }), ctx))?.answer).toMatch(/nothing waiting/);
  });
  it("shows the careful fixed text for a crisis or an unsafe request", async () => {
    expect((await dispatchDecision(decision({ operation: "crisis" }), ctx))?.answer).toBe(CRISIS_RESPONSE);
    expect((await dispatchDecision(decision({ operation: "unsafe" }), ctx))?.answer).toBe(UNSAFE_REFUSAL);
    expect(CRISIS_RESPONSE).toMatch(/988/);
  });
});

describe("unsure means ask, and nothing runs (R19.6)", () => {
  it.each([decision({ operation: "clarify", confidence: 0.4, clarification: "Which one?" }), decision({ operation: "finance_spending", confidence: 0.4, clarification: "Which one?" })])("%#", async (d) => {
    expect(await dispatchDecision(d, ctx)).toMatchObject({ answer: "Which one?", status: "waiting_for_user" });
    for (const mock of [mocks.answerFinance, mocks.runBillsCommand, mocks.answerCalendar, mocks.prepareCalendarCreate, mocks.prepareCalendarDelete, mocks.handleEmailConversationTurn, mocks.saveLearning]) expect(mock).not.toHaveBeenCalled();
  });
});

describe("drafts, redirects and choices (R22, R23, R25)", () => {
  it("answers a drafting request honestly while drafting is not released, and never makes up a draft", async () => {
    const result = await dispatchDecision(decision({ operation: "email_draft", draft: { action: "create", kind: "reply", to: "sarah", replyTo: null, instruction: "say yes", version: null } }), ctx);
    expect(result?.answer).toMatch(/can't save email drafts yet/);
    expect(result?.answer).toMatch(/summarise the email/);
    expect(result?.agents).toEqual(["email"]);
  });

  it("shows a redirect's own message, so an off-topic message is helped, not refused", async () => {
    const plan = { category: "speculation" as const, reply: "I can't tell you how they came by theirs, but I can help you find vintage shops near you.", pivot: { capability: "web" as const, ask: null }, distress: false };
    const result = await dispatchDecision(decision({ operation: "redirect", redirect: plan }), ctx);
    expect(result).toMatchObject({ answer: plan.reply, status: "completed" });
    expect(mocks.answerCasual).not.toHaveBeenCalled();
  });

  it("waits for the one missing detail when the pivot needs it", async () => {
    const plan = { category: "unrelated" as const, reply: "Happy to look around. Which city or ZIP should I use?", pivot: { capability: "web" as const, ask: "Which city or ZIP?" }, distress: false };
    expect((await dispatchDecision(decision({ operation: "redirect", redirect: plan }), ctx))?.status).toBe("waiting_for_user");
  });

  it("passes the choices for a clarifying question along to be shown as buttons", async () => {
    const result = await dispatchDecision(decision({ operation: "clarify", clarification: "Is that 3 AM or 3 PM?", choices: ["3 AM", "3 PM"], confidence: 0.4 }), ctx);
    expect(result).toMatchObject({ answer: "Is that 3 AM or 3 PM?", status: "waiting_for_user", choices: ["3 AM", "3 PM"] });
  });

  it("offers no buttons when there are none", async () => {
    const result = await dispatchDecision(decision({ operation: "clarify", clarification: "Which one?", choices: null, confidence: 0.4 }), ctx);
    expect(result).not.toHaveProperty("choices");
  });
});
