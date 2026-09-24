vi.mock("@/lib/workflows/email-scan", () => ({cancelEmailScan: vi.fn(async () => false)}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Learning } from "@/lib/learning/learnings";
import type { RouterDecision } from "./router";

const mocks = vi.hoisted(() => ({
  answerCalendar: vi.fn(), prepareCalendarCreate: vi.fn(), answerFinance: vi.fn(), answerPublicSearch: vi.fn(), runBillsCommand: vi.fn(), answerStatusLookup: vi.fn(),
  answerGeneral: vi.fn(), draftHistory: vi.fn(), answerCasual: vi.fn(), prepareCalendarAttendeeUpdate: vi.fn(), prepareCalendarDelete: vi.fn(), handleEmailConversationTurn: vi.fn(), answerScheduleFeasibility: vi.fn(), answerDailyView: vi.fn(), saveSearchState: vi.fn(), loadRecentSearchStates: vi.fn(), renderSearchHistory: vi.fn(), prepareEmailDraft: vi.fn(), resolveEmailDraft: vi.fn(), ownerIdentity: vi.fn(), loadEmailState: vi.fn(),
  runLearningCommand: vi.fn(), executeReadOnlyAgentPlan: vi.fn(), saveLearning: vi.fn(),
  resolveDelete: vi.fn(), resolveAttendees: vi.fn(), resolveCreate: vi.fn(), resolveFinance: vi.fn(),
  listMemories: vi.fn(), createMemory: vi.fn(), forgetMemory: vi.fn(), supersedeMemory: vi.fn(),
  extractMemoriesForUser: vi.fn(), findMatchingMemories: vi.fn(), renderMemories: vi.fn(),
}));
vi.mock("@/lib/memory/store", () => ({ listMemories: mocks.listMemories, createMemory: mocks.createMemory, forgetMemory: mocks.forgetMemory, supersedeMemory: mocks.supersedeMemory }));
vi.mock("@/lib/memory/context", () => ({ buildMemoryContext: () => "" }));
vi.mock("@/lib/memory/commands", () => ({ findMatchingMemories: mocks.findMatchingMemories, renderMemories: mocks.renderMemories }));
vi.mock("@/lib/memory/extractor-runtime", () => ({ extractMemoriesForUser: mocks.extractMemoriesForUser }));
vi.mock("@/lib/agents/calendar", () => ({ answerCalendar: mocks.answerCalendar }));
vi.mock("@/lib/agents/calendar-create", () => ({ prepareCalendarCreate: mocks.prepareCalendarCreate }));
vi.mock("@/lib/agents/finance", () => ({ answerFinance: mocks.answerFinance }));
vi.mock("@/lib/agents/general", () => ({ answerPublicSearch: mocks.answerPublicSearch }));
vi.mock("@/lib/agents/bills-agent", () => ({ runBillsCommand: mocks.runBillsCommand }));
vi.mock("@/lib/agents/status-lookup", () => ({ answerStatusLookup: mocks.answerStatusLookup }));
vi.mock("@/lib/learning/store", () => ({ saveLearning: mocks.saveLearning }));
vi.mock("@/lib/model/claude", () => ({ answerGeneral: mocks.answerGeneral, answerCasual: mocks.answerCasual }));
vi.mock("@/lib/agents/draft-history", () => ({answerDraftHistory: mocks.draftHistory}));
vi.mock("@/lib/runtime/query-budget", () => ({ prepareAgentStage: () => undefined }));
vi.mock("@/lib/workflows/calendar-create", () => ({
  prepareCalendarAttendeeUpdate: mocks.prepareCalendarAttendeeUpdate, prepareCalendarDelete: mocks.prepareCalendarDelete,
  resolvePendingCalendarDelete: mocks.resolveDelete, resolvePendingCalendarAttendeeUpdate: mocks.resolveAttendees, resolvePendingCalendarCreate: mocks.resolveCreate,
}));
vi.mock("@/lib/workflows/finance-import", () => ({ resolvePendingFinanceImport: mocks.resolveFinance }));
vi.mock("@/lib/agents/email-draft", () => ({ prepareEmailDraft: mocks.prepareEmailDraft }));
vi.mock("@/lib/workflows/email-draft", () => ({ resolvePendingEmailDraft: mocks.resolveEmailDraft }));
vi.mock("@/lib/auth/owner", () => ({ ownerIdentity: mocks.ownerIdentity }));
vi.mock("@/lib/conversations/email-state", () => ({ loadEmailState: mocks.loadEmailState }));
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
  mocks.answerGeneral.mockResolvedValue(CRISIS_RESPONSE);
  mocks.answerFinance.mockResolvedValue("FINANCE"); mocks.runBillsCommand.mockResolvedValue("BILLS"); mocks.answerDailyView.mockResolvedValue("DAILY"); mocks.answerStatusLookup.mockResolvedValue("STATUS");
  mocks.answerCalendar.mockResolvedValue("CALENDAR"); mocks.answerPublicSearch.mockResolvedValue("WEB"); mocks.answerCasual.mockResolvedValue("CASUAL");
  mocks.prepareCalendarCreate.mockResolvedValue("CREATE"); mocks.prepareCalendarDelete.mockResolvedValue("DELETE"); mocks.prepareCalendarAttendeeUpdate.mockResolvedValue("ATTENDEES");
  mocks.runLearningCommand.mockResolvedValue({ answer: "LEARNING", agents: [], status: "completed" }); mocks.executeReadOnlyAgentPlan.mockResolvedValue([{ agent: "email", ok: true, answer: "x" }]);
  mocks.saveLearning.mockResolvedValue(undefined);
  mocks.resolveEmailDraft.mockResolvedValue(null); mocks.ownerIdentity.mockResolvedValue({ name: "Bharath", email: "me@example.com" }); mocks.loadEmailState.mockResolvedValue(null);
  for (const resolver of [mocks.resolveDelete, mocks.resolveAttendees, mocks.resolveCreate, mocks.resolveFinance]) resolver.mockResolvedValue(null);
  mocks.listMemories.mockResolvedValue([]); mocks.extractMemoriesForUser.mockResolvedValue([]); mocks.findMatchingMemories.mockReturnValue([]); mocks.renderMemories.mockReturnValue("memories");
});

vi.mock("@/lib/conversations/search-state", () => ({ saveSearchState: (...args: unknown[]) => mocks.saveSearchState(...args), loadRecentSearchStates: (...args: unknown[]) => mocks.loadRecentSearchStates(...args), renderSearchHistory: (...args: unknown[]) => mocks.renderSearchHistory(...args) }));

describe("an answer is always text (free)", () => {
  it("replaces anything that is not text with a plain message, instead of showing [object Object]", async () => {
    mocks.answerPublicSearch.mockResolvedValueOnce({ text: "an object" } as never);
    const result = await dispatchDecision(decision({ operation: "web_search", searchQuery: "q" } as never), ctx);
    expect(result?.answer).toMatch(/trouble putting that answer together/);
    expect(result?.answer).not.toContain("[object Object]");
  });
});

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
  it("asks rather than searching the raw message when the router wrote no query (R19.5: a web_search always names its own search)", async () => {
    const result = await dispatchDecision(decision({ operation: "web_search" }), ctx);
    expect(mocks.answerPublicSearch).not.toHaveBeenCalled();
    expect(result?.answer).toMatch(/what place should i search/i);
    expect(result?.status).toBe("waiting_for_user");
  });
});

describe("listing every saved search is rendered in code, never left for a model to enumerate (R29)", () => {
  it("skips the model entirely and renders the saved records directly", async () => {
    mocks.loadRecentSearchStates.mockResolvedValue([{ query: "Chinese restaurants in Sunnyvale, CA", places: [{ name: "Ginger Cafe" }], updatedAt: 1 }]);
    mocks.renderSearchHistory.mockReturnValue("**Chinese**\n- Ginger Cafe");
    const result = await dispatchDecision(decision({ operation: "general_answer", listSavedSearches: true } as never), ctx);
    expect(mocks.answerGeneral).not.toHaveBeenCalled();
    expect(mocks.loadRecentSearchStates).toHaveBeenCalledWith("u1");
    expect(result?.answer).toBe("**Chinese**\n- Ginger Cafe");
  });
  it("still uses the model for a narrower recall question about the same saved records", async () => {
    mocks.answerGeneral.mockResolvedValue("They're on Wolfe Road.");
    const result = await dispatchDecision(decision({ operation: "general_answer" }), ctx);
    expect(mocks.renderSearchHistory).not.toHaveBeenCalled();
    expect(result?.answer).toBe("They're on Wolfe Road.");
  });
});

describe("memory (phase 1: facts, preferences and rules)", () => {
  it("memory_show lists active and pending memories", async () => {
    mocks.listMemories.mockResolvedValueOnce([{ id: "m1" }]).mockResolvedValueOnce([{ id: "m2" }]);
    mocks.renderMemories.mockReturnValue("### What I remember");
    const result = await dispatchDecision(decision({ operation: "memory_show" }), ctx);
    expect(mocks.listMemories).toHaveBeenCalledWith("u1", ["active"]);
    expect(mocks.listMemories).toHaveBeenCalledWith("u1", ["pending"]);
    expect(result?.answer).toBe("### What I remember");
  });
  it("memory_forget removes every match and says what it forgot", async () => {
    mocks.findMatchingMemories.mockReturnValue([{ id: "m1", statement: "Doesn't eat meat except fish and chicken" }]);
    const result = await dispatchDecision(decision({ operation: "memory_forget", term: "meat" } as never), ctx);
    expect(mocks.forgetMemory).toHaveBeenCalledWith("u1", "m1");
    expect(result?.answer).toContain("Doesn't eat meat except fish and chicken");
  });
  it("memory_forget says so plainly, and forgets nothing, when there's no match", async () => {
    mocks.findMatchingMemories.mockReturnValue([]);
    const result = await dispatchDecision(decision({ operation: "memory_forget", term: "sushi" } as never), ctx);
    expect(mocks.forgetMemory).not.toHaveBeenCalled();
    expect(result?.answer).toMatch(/don't have anything remembered/);
  });
  it("memory_remember saves synchronously (bypasses the pending gate) and confirms in the same turn", async () => {
    mocks.extractMemoriesForUser.mockResolvedValue([{ action: "add", type: "fact", category: "diet", strength: "hard", statement: "Doesn't eat meat except fish and chicken", stated: false, validUntil: null, supersedes: null }]);
    const result = await dispatchDecision(decision({ operation: "memory_remember", memoryStatement: "I don't eat meat except fish and chicken" } as never), ctx);
    expect(mocks.createMemory).toHaveBeenCalledWith("u1", expect.objectContaining({ status: "active", statement: "Doesn't eat meat except fish and chicken" }));
    expect(result?.answer).toContain("Doesn't eat meat except fish and chicken");
  });
  it("memory_remember says so when nothing specific could be extracted, rather than a silent no-op", async () => {
    mocks.extractMemoriesForUser.mockResolvedValue([]);
    const result = await dispatchDecision(decision({ operation: "memory_remember", memoryStatement: "remember stuff" } as never), ctx);
    expect(mocks.createMemory).not.toHaveBeenCalled();
    expect(result?.status).toBe("waiting_for_user");
  });
});

describe("each operation calls its own handler (R19.4)", () => {
  it.each([
    [decision({ operation: "finance_spending" }), () => mocks.answerFinance, "FINANCE"],
    [decision({ operation: "finance_record" }), () => mocks.answerFinance, "FINANCE"],
    [decision({ operation: "bills_list" }), () => mocks.runBillsCommand, "BILLS"],
    [decision({ operation: "daily_view" }), () => mocks.answerDailyView, "DAILY"],
    [decision({ operation: "calendar_query" }), () => mocks.answerCalendar, "CALENDAR"],
    [decision({ operation: "web_search", searchQuery: "q" } as never), () => mocks.answerPublicSearch, "WEB"],
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
  it("hands a drafting request to the draft agent with who the owner is and the saved email search, and shows its preview", async () => {
    mocks.prepareEmailDraft.mockResolvedValue({ answer: "PREVIEW", status: "waiting_for_user", choices: ["a", "b"] });
    const draft = { action: "create" as const, kind: "reply" as const, to: "sarah", replyTo: null, instruction: "say yes", version: null };
    const result = await dispatchDecision(decision({ operation: "email_draft", draft }), ctx);
    expect(mocks.prepareEmailDraft).toHaveBeenCalledWith(draft, expect.objectContaining({ userId: "u1", conversationId: "c1", ownerName: "Bharath", ownerEmail: "me@example.com" }));
    expect(result).toMatchObject({ answer: "PREVIEW", status: "waiting_for_user", agents: ["email"], choices: ["a", "b"] });
  });

  it("asks what to write when the router chose drafting but read no details", async () => {
    const result = await dispatchDecision(decision({ operation: "email_draft", draft: null }), ctx);
    expect(result?.answer).toMatch(/new email or reply/);
    expect(mocks.prepareEmailDraft).not.toHaveBeenCalled();
  });

  it("lets Confirm and Cancel reach a pending draft", async () => {
    mocks.resolveEmailDraft.mockResolvedValueOnce({ answer: "SAVED", status: "completed" });
    expect((await dispatchDecision(decision({ operation: "approve" }), ctx))?.answer).toBe("SAVED");
    expect(mocks.resolveEmailDraft).toHaveBeenCalledWith("u1", "c1", "confirm");
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


it("lists saved drafts directly across conversations without asking or showing learnings", async () => {
  mocks.draftHistory.mockResolvedValue("Saved drafts: Sarah, Ayushman");
  const result=await dispatchDecision(decision({operation:"email_draft_history"}), {...ctx,input:"Daylark's saved drafts"});
  expect(result?.answer).toContain("Sarah");
  expect(mocks.draftHistory).toHaveBeenCalledWith("u1");
  expect(mocks.runLearningCommand).not.toHaveBeenCalled();
});

it("dismisses a conversational offer without resolving an approval", async () => {
  expect((await dispatchDecision(decision({operation:"dismiss"}), {...ctx,input:"Nah leave it"}))?.answer).toContain("leave it there");
  expect(mocks.resolveFinance).not.toHaveBeenCalled();
});

it("passes translation and supportive follow-ups to the answerer with their context",async()=>{
  mocks.answerGeneral.mockResolvedValue("నాకు ఇక జీవించాలని అనిపించడం లేదు.");
  const context=[{role:"user" as const,content:"Translate to Telugu: I don't feel like living anymore"}];
  const result=await dispatchDecision(decision({operation:"general_answer"}), {...ctx,input:"I need translation",context});
  expect(mocks.answerGeneral).toHaveBeenCalledWith("I need translation",context,"general","");
  expect(result?.answer).toContain("నాకు");
});

it("does not render an empty model reply as a blank assistant message",async()=>{
  mocks.answerGeneral.mockResolvedValue("   ");
  const result=await dispatchDecision(decision({operation:"general_answer"}), ctx);
  expect(result?.answer.trim().length).toBeGreaterThan(0);
});

it("preserves the specialist's choices so the selected reply resolves its question", async () => {
  mocks.handleEmailConversationTurn.mockResolvedValue({ answer: "Which result?", agents: ["email"], status: "waiting_for_user", choices: ["1", "2"] });
  const result = await dispatchDecision(decision({ operation: "email" }), ctx);
  expect(result?.choices).toEqual(["1", "2"]);
});

it("answers requested financial guidance without recording a transaction or changing bills",async()=>{
  mocks.answerGeneral.mockResolvedValue("Start with a small emergency buffer, then compare debt interest costs.");
  const context=[{role:"user" as const,content:"Help me make a savings plan."}];
  const result=await dispatchDecision(decision({operation:"general_answer"}),{...ctx,input:"What should I prioritize?",context});
  expect(result?.answer).toContain("emergency buffer");
  expect(mocks.answerGeneral).toHaveBeenCalledWith("What should I prioritize?",context,"general","");
  expect(mocks.answerFinance).not.toHaveBeenCalled();
  expect(mocks.runBillsCommand).not.toHaveBeenCalled();
  expect(mocks.resolveFinance).not.toHaveBeenCalled();
});

it("passes an explicit read mode and conversation context for transaction listing",async()=>{
 const context=[{role:"user" as const,content:"August and September this year"}];
 await dispatchDecision(decision({operation:"finance_spending"}),{...ctx,input:"show all transactions",context});
 expect(mocks.answerFinance).toHaveBeenCalledWith("show all transactions","u1","read",context);
});
it("uses record mode only for the transaction-entry operation",async()=>{
 await dispatchDecision(decision({operation:"finance_record"}),ctx);
 expect(mocks.answerFinance).toHaveBeenCalledWith(ctx.input,"u1","record",ctx.context);
});
