import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailRequest } from "@/lib/agents/email-request";
import type { EmailState } from "@/lib/conversations/email-state";
import { NO_LEARNINGS, withLearning, type Learning, type Learnings } from "@/lib/learning/learnings";

const mocks = vi.hoisted(() => ({
  state: null as EmailState | null,
  learnings: null as unknown as Learnings,
  saved: [] as Learning[],
  interpretation: null as unknown,
  answerEmail: vi.fn(),
  importForMessage: vi.fn(),
}));

vi.mock("@/lib/conversations/email-state", () => ({ loadEmailState: async () => mocks.state, saveEmailState: async () => undefined }));
vi.mock("@/lib/learning/store", () => ({
  loadLearnings: async () => mocks.learnings,
  saveLearning: async (_user: string, learning: Learning) => { mocks.saved.push(learning); },
}));
vi.mock("@/lib/agents/email-interpreter-runtime", () => ({ interpretEmailForUser: async () => mocks.interpretation }));
vi.mock("@/lib/agents/email", () => ({ answerEmail: (...args: unknown[]) => mocks.answerEmail(...args), invoiceFactsForMessage: vi.fn(), showEmailMessage: vi.fn() }));
vi.mock("@/lib/agents/email-finance-import", () => ({ prepareEmailFinanceImport: vi.fn(), prepareImportForMessage: (...args: unknown[]) => mocks.importForMessage(...args) }));
vi.mock("@/lib/runtime/query-budget", () => ({ prepareAgentStage: () => undefined }));

import { handleEmailConversationTurn } from "./email-turn";

const request = (over: Partial<EmailRequest>): EmailRequest => ({ action: "list", topic: "receipt", sender: "iherb", days: 365, calendar: null, unread: false, humansOnly: false, exclusion: "", ...over });
const interpreted = (over: Partial<EmailRequest>, extra: Record<string, unknown> = {}) => ({ domain: "email", request: request(over), confidence: 1, clarification: null, reading: "", pick: null, correction: false, plainList: false, source: "model", ...extra });
const stateWith = (over: Partial<EmailRequest>): EmailState => ({ request: request(over), results: [{ id: "m1", subject: "Order Confirmed #947597212", from: "iHerb <noreply@info.iherb.com>", date: "Tue, 15 Sep 2026 10:00:00 -0700" }], updatedAt: Date.now() });

beforeEach(() => {
  mocks.state = null;
  mocks.learnings = NO_LEARNINGS;
  mocks.saved = [];
  mocks.answerEmail.mockReset().mockResolvedValue("ANSWER");
  mocks.importForMessage.mockReset().mockResolvedValue("IMPORT PREVIEW");
});

describe("learning what a request means (R11.8), through the real turn handler", () => {
  const correction = "I didn't mean order confirmation mails, I meant the amount receipts";

  it("teaches Daylark when a correction turns a plain list into amounts, and says so", async () => {
    mocks.state = stateWith({ action: "list" });
    mocks.interpretation = interpreted({ action: "amounts" }, { correction: true });
    const turn = await handleEmailConversationTurn(correction, "u1", "c1", []);
    expect(mocks.saved).toEqual([{ kind: "default_action", topic: "receipt", action: "amounts" }]);
    expect(turn?.answer).toMatch(/^Got it\. From now on, a request for receipts shows the amounts/);
    expect(turn?.answer).toMatch(/ANSWER$/);
  });

  it("also teaches with a curly apostrophe", async () => {
    mocks.state = stateWith({ action: "list" });
    mocks.interpretation = interpreted({ action: "amounts" }, { correction: true });
    await handleEmailConversationTurn("I didn’t mean order confirmation mails, I meant the amount receipts", "u1", "c1", []);
    expect(mocks.saved).toHaveLength(1);
  });

  it("still teaches when the previous answer was already amounts (asked again in the same chat)", async () => {
    mocks.state = stateWith({ action: "amounts" });
    mocks.interpretation = interpreted({ action: "amounts" }, { correction: true });
    const turn = await handleEmailConversationTurn(correction, "u1", "c1", []);
    expect(mocks.saved).toEqual([{ kind: "default_action", topic: "receipt", action: "amounts" }]);
    expect(turn?.answer).toMatch(/^Got it/);
  });

  it("teaches with no saved search at all", async () => {
    mocks.interpretation = interpreted({ action: "amounts" }, { correction: true });
    await handleEmailConversationTurn(correction, "u1", "c9", []);
    expect(mocks.saved).toHaveLength(1);
  });

  it("does not save or announce it a second time once it is learned", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "default_action", topic: "receipt", action: "amounts" });
    mocks.state = stateWith({ action: "list" });
    mocks.interpretation = interpreted({ action: "amounts" }, { correction: true });
    const turn = await handleEmailConversationTurn(correction, "u1", "c1", []);
    expect(mocks.saved).toEqual([]);
    expect(turn?.answer).toBe("ANSWER");
  });

  it("does not teach from an ordinary question", async () => {
    mocks.state = stateWith({ action: "list" });
    mocks.interpretation = interpreted({ action: "amounts" });
    await handleEmailConversationTurn("show the amounts on my iherb receipts", "u1", "c1", []);
    expect(mocks.saved).toEqual([]);
  });

  it("applies what was learned to a plain receipt request in a new conversation", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "default_action", topic: "receipt", action: "amounts" });
    mocks.interpretation = interpreted({ action: "list" });
    const turn = await handleEmailConversationTurn("show all iherb recipts", "u1", "c2", []);
    expect(mocks.answerEmail.mock.calls[0][0]).toMatch(/amounts/i);
    expect(turn?.answer).toMatch(/Showing amounts because you asked for that/);
  });

  it("gives the plain list when the message asks for the emails", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "default_action", topic: "receipt", action: "amounts" });
    mocks.interpretation = interpreted({ action: "list" }, { plainList: true });
    const turn = await handleEmailConversationTurn("show all iherb receipt emails", "u1", "c2", []);
    expect(mocks.answerEmail.mock.calls[0][0]).not.toMatch(/amounts/i);
    expect(turn?.answer).not.toMatch(/Showing amounts/);
  });
});

describe("picking one order from an import card (R13, R20.5)", () => {
  const card: EmailState = {
    request: request({ action: "import_all" }),
    results: ["947597212", "946705324", "946406863", "945937985"].map((order, index) => ({ id: `m${index + 1}`, subject: `Order Confirmed #${order}`, from: "iHerb <noreply@info.iherb.com>", date: `${["Tue, 15 Sep", "Mon, 3 Aug", "Fri, 17 Jul", "Thu, 4 Jun"][index]} 2026 10:00:00 -0700` })),
    updatedAt: Date.now(),
  };

  it("imports exactly the email the model says the person pointed at, as a new approval", async () => {
    mocks.state = card;
    mocks.interpretation = interpreted({ action: "import_all" }, { pick: { index: 1, action: "import" } });
    const turn = await handleEmailConversationTurn("actually import only the second one", "u1", "c1", []);
    expect(mocks.importForMessage).toHaveBeenCalledWith("u1", "c1", "m2");
    expect(turn).toMatchObject({ answer: "IMPORT PREVIEW", status: "waiting_for_user", agents: ["email", "finance"] });
  });

  it("asks which one, with numbered choices, when the model is unsure which was meant", async () => {
    mocks.state = card;
    mocks.interpretation = interpreted({ action: "list" }, { confidence: 0.4, clarification: "Which one? Say a number from 1 to 4." });
    const asked = await handleEmailConversationTurn("import that one", "u1", "c1", []);
    expect(asked?.answer).toMatch(/Say a number from 1 to 4/);
    expect(asked?.choices).toEqual(["1", "2", "3", "4"]);
    expect(mocks.importForMessage).not.toHaveBeenCalled();
  });
});

describe("when the model cannot read the message (R20.5)", () => {
  it("says so, and searches nothing", async () => {
    mocks.interpretation = { ...interpreted({}), domain: "other", source: "unavailable" };
    const turn = await handleEmailConversationTurn("show all iherb receipts", "u1", "c1", []);
    expect(turn?.answer).toMatch(/AI model isn't available/);
    expect(mocks.answerEmail).not.toHaveBeenCalled();
  });

  it("returns null when the model says the message is not about email", async () => {
    mocks.interpretation = { ...interpreted({}), domain: "other" };
    expect(await handleEmailConversationTurn("what's on my calendar", "u1", "c1", [])).toBeNull();
  });
});
