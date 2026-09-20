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
const interpreted = (over: Partial<EmailRequest>) => ({ domain: "email", request: request(over), confidence: 1, clarification: null, reading: "", source: "model" });
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
    mocks.interpretation = interpreted({ action: "amounts" });
    const turn = await handleEmailConversationTurn(correction, "u1", "c1", []);
    expect(mocks.saved).toEqual([{ kind: "default_action", topic: "receipt", action: "amounts" }]);
    expect(turn?.answer).toMatch(/^Got it\. From now on, a request for receipts shows the amounts/);
    expect(turn?.answer).toMatch(/ANSWER$/);
  });

  it("also teaches with a curly apostrophe", async () => {
    mocks.state = stateWith({ action: "list" });
    mocks.interpretation = interpreted({ action: "amounts" });
    await handleEmailConversationTurn("I didn’t mean order confirmation mails, I meant the amount receipts", "u1", "c1", []);
    expect(mocks.saved).toHaveLength(1);
  });

  it("still teaches when the previous answer was already amounts (asked again in the same chat)", async () => {
    mocks.state = stateWith({ action: "amounts" });
    mocks.interpretation = interpreted({ action: "amounts" });
    const turn = await handleEmailConversationTurn(correction, "u1", "c1", []);
    expect(mocks.saved).toEqual([{ kind: "default_action", topic: "receipt", action: "amounts" }]);
    expect(turn?.answer).toMatch(/^Got it/);
  });

  it("teaches with no saved search at all", async () => {
    mocks.interpretation = interpreted({ action: "amounts" });
    await handleEmailConversationTurn(correction, "u1", "c9", []);
    expect(mocks.saved).toHaveLength(1);
  });

  it("does not save or announce it a second time once it is learned", async () => {
    mocks.learnings = withLearning(NO_LEARNINGS, { kind: "default_action", topic: "receipt", action: "amounts" });
    mocks.state = stateWith({ action: "list" });
    mocks.interpretation = interpreted({ action: "amounts" });
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
    mocks.interpretation = interpreted({ action: "list" });
    const turn = await handleEmailConversationTurn("show all iherb receipt emails", "u1", "c2", []);
    expect(mocks.answerEmail.mock.calls[0][0]).not.toMatch(/amounts/i);
    expect(turn?.answer).not.toMatch(/Showing amounts/);
  });

  it("can be stated outright, and re-runs the last search with it", async () => {
    mocks.state = stateWith({ action: "list" });
    mocks.interpretation = interpreted({ action: "list" });
    const turn = await handleEmailConversationTurn("always show amounts for receipts", "u1", "c1", []);
    expect(mocks.saved).toEqual([{ kind: "default_action", topic: "receipt", action: "amounts" }]);
    expect(turn?.answer).toMatch(/^Got it/);
    expect(mocks.answerEmail.mock.calls[0][0]).toMatch(/amounts/i);
  });
});

describe("picking one order from an import card (R13)", () => {
  const card: EmailState = {
    request: request({ action: "import_all" }),
    results: ["947597212", "946705324", "946406863", "945937985"].map((order, index) => ({ id: `m${index + 1}`, subject: `Order Confirmed #${order}`, from: "iHerb <noreply@info.iherb.com>", date: `${["Tue, 15 Sep", "Fri, 14 Aug", "Mon, 3 Aug", "Fri, 17 Jul"][index]} 2026 10:00:00 -0700` })),
    updatedAt: Date.now(),
  };

  it("imports exactly the email the user pointed at, as a new approval", async () => {
    mocks.state = card;
    const turn = await handleEmailConversationTurn("actually import only the second one", "u1", "c1", []);
    expect(mocks.importForMessage).toHaveBeenCalledWith("u1", "c1", "m2");
    expect(turn).toMatchObject({ answer: "IMPORT PREVIEW", status: "waiting_for_user", agents: ["email", "finance"] });
  });

  it("asks which one when the reference is ambiguous, and says how many there are when it is out of range", async () => {
    mocks.state = card;
    expect((await handleEmailConversationTurn("import that one", "u1", "c1", []))?.answer).toMatch(/Say a number from 1 to 4/);
    expect((await handleEmailConversationTurn("import the fifth one", "u1", "c1", []))?.answer).toMatch(/only showed 4 results/);
    expect(mocks.importForMessage).not.toHaveBeenCalled();
  });
});
