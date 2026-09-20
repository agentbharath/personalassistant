import { describe, expect, it, vi } from "vitest";
import type { EmailState } from "@/lib/conversations/email-state";
import type { EmailRequest } from "./email-request";
import { INTERPRETER_SYSTEM, INTERPRETER_VERSION, buildInterpreterMessage, canonicalize, interpretEmail, interpretWithRules, type InterpretationCache, type InterpreterInput } from "./email-interpreter";

const output = (overrides: Record<string, unknown> = {}) => ({
  domain: "email", action: "list", topic: "receipt", sender: "iherb", days: null, calendar: null, unread: false, humansOnly: false,
  exclusion: "", confidence: 0.95, clarification: null, reading: "iherb receipts", ...overrides,
});
const reply = (value: unknown) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] }) as never;
const input = (message: string, state: EmailState | null = null): InterpreterInput => ({ userId: "u1", message, state, context: [] });
const memoryCache = (): InterpretationCache & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return { store, get: async (key) => store.get(key) ?? null, set: async (key, value) => { store.set(key, value); } };
};

describe("what the model is asked (R16.2, R16.3)", () => {
  it("calls the model at temperature 0 with a JSON schema and the versioned prompt", async () => {
    const complete = vi.fn().mockResolvedValue(reply(output()));
    await interpretEmail(input("all iherb recipts"), { complete });
    const params = complete.mock.calls[0][0];
    expect(params.temperature).toBe(0);
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.system).toBe(INTERPRETER_SYSTEM);
    expect(INTERPRETER_VERSION).toMatch(/^email-v\d+$/);
  });
  it("gives the model no tools", async () => {
    const complete = vi.fn().mockResolvedValue(reply(output()));
    await interpretEmail(input("all iherb recipts"), { complete });
    expect(complete.mock.calls[0][0].tools).toBeUndefined();
  });
  it("sends the saved request and numbered results, and no dates or clocks", () => {
    const state: EmailState = { request: { action: "list", topic: "receipt", sender: "iherb", days: null, calendar: null, unread: false, humansOnly: false, exclusion: "" }, results: [{ id: "m1", subject: "Order Confirmed #947597212", from: "iHerb <noreply@info.iherb.com>", date: "Tue, 15 Sep 2026 10:00:00 -0700" }], updatedAt: 123456789 };
    const message = buildInterpreterMessage(input("the amount receipts", state));
    expect(message).toContain('"sender":"iherb"');
    expect(message).toContain('"n":1');
    expect(message).not.toContain("2026");
    expect(message).not.toContain("123456789");
  });
});

describe("the same input resolves the same way (R16.3)", () => {
  it("answers a repeat from the cache without a second model call", async () => {
    const complete = vi.fn().mockResolvedValue(reply(output()));
    const cache = memoryCache();
    const first = await interpretEmail(input("all iherb recipts"), { complete, cache });
    const second = await interpretEmail(input("  ALL iherb   recipts "), { complete, cache });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(first.source).toBe("model");
    expect(second.source).toBe("cache");
    expect(second.request).toEqual(first.request);
  });
  it("keys on the saved context, so the same words after a different search are interpreted again", async () => {
    const complete = vi.fn().mockResolvedValue(reply(output()));
    const cache = memoryCache();
    const state = (sender: string): EmailState => ({ request: { action: "list", topic: "receipt", sender, days: null, calendar: null, unread: false, humansOnly: false, exclusion: "" }, results: [], updatedAt: 1 });
    await interpretEmail(input("only unread", state("iherb")), { complete, cache });
    await interpretEmail(input("only unread", state("adobe")), { complete, cache });
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("keys on the user, so one person's cache is never served to another", async () => {
    const complete = vi.fn().mockResolvedValue(reply(output()));
    const cache = memoryCache();
    await interpretEmail(input("all iherb recipts"), { complete, cache });
    await interpretEmail({ ...input("all iherb recipts"), userId: "u2" }, { complete, cache });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

describe("code has the last word (R16.4)", () => {
  const canon = (overrides: Record<string, unknown>, message = "show iherb receipts") => canonicalize(output(overrides) as never, message);
  it("never accepts a pronoun, verb, or document word as a sender", () => {
    for (const sender of ["mean", "my", "the amount", "receipts", "last 30 days", "unread"]) expect(canon({ sender }).request.sender).toBeNull();
    expect(canon({ sender: "iherb" }).request.sender).toBe("iherb");
    expect(canon({ sender: "Amazon Web Services" }).request.sender).toBe("Amazon Web Services");
    expect(canon({ sender: "alice@example.com" }).request.sender).toBe("alice@example.com");
  });
  it("clamps windows to whole days from 1 to 365 and keeps only one window", () => {
    expect(canon({ days: 9999 }, "iherb receipts last 9999 days").request.days).toBe(365);
    expect(canon({ days: 0 }, "iherb receipts last 0 days").request.days).toBe(1);
    expect(canon({ days: 30.4 }, "iherb receipts last 30 days").request.days).toBe(30);
    expect(canon({ days: 30, calendar: "today" }, "iherb receipts today, not the last 30 days").request).toMatchObject({ days: null, calendar: "today" });
  });
  it("turns 'all' with no window into the longest window (R11.7)", () => {
    expect(canon({}, "show all iherb receipts").request.days).toBe(365);
    expect(canon({ days: 60 }, "show all iherb receipts last 60 days").request.days).toBe(60);
    expect(canon({}, "show iherb receipts").request.days).toBeNull();
  });
  it("makes imports and amounts receipt requests", () => {
    expect(canon({ action: "import_all", topic: "general" }, "import all iherb receipts").request.topic).toBe("receipt");
    expect(canon({ action: "amounts", topic: "promotion" }, "show the amounts on my iherb receipts").request.topic).toBe("receipt");
  });
  it("passes a non-email message through untouched (R16.6)", () => {
    expect(canonicalize(output({ domain: "other", sender: "x" }) as never, "what's on my calendar").domain).toBe("other");
  });
});

describe("unsure or failing (R16.5, R16.7)", () => {
  it("returns the clarification and low confidence for the caller to ask", async () => {
    const complete = vi.fn().mockResolvedValue(reply(output({ topic: "general", confidence: 0.4, clarification: "Receipts, promotions, or everything from Adobe?" })));
    const result = await interpretEmail(input("adobe"), { complete });
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.clarification).toMatch(/Receipts, promotions/);
  });
  it.each([["a thrown error", () => Promise.reject(new Error("boom"))], ["not JSON", () => Promise.resolve(reply("nope"))], ["a wrong shape", () => Promise.resolve(reply({ domain: "email" }))]])("falls back to the rules on %s, and says so", async (_name, make) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await interpretEmail(input("all iherb recipts"), { complete: make as never });
    expect(result.source).toBe("rules");
    expect(result.request).toMatchObject({ topic: "receipt", sender: "iherb" });
    expect(warn).toHaveBeenCalledWith("email_interpreter_fallback", expect.stringContaining(INTERPRETER_VERSION));
    warn.mockRestore();
  });
  it("does not cache a fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cache = memoryCache();
    await interpretEmail(input("all iherb recipts"), { complete: () => Promise.reject(new Error("x")), cache });
    expect(cache.store.size).toBe(0);
  });
  it("a broken cache never blocks an answer", async () => {
    const complete = vi.fn().mockResolvedValue(reply(output()));
    const broken: InterpretationCache = { get: () => Promise.reject(new Error("down")), set: () => Promise.reject(new Error("down")) };
    expect((await interpretEmail(input("all iherb recipts"), { complete, cache: broken })).source).toBe("model");
  });
  it("the rules reading calls a non-email message 'other'", () => {
    expect(interpretWithRules(input("what is the weather")).domain).toBe("other");
  });
});

describe("confidence noise (R16.3)", () => {
  it("keeps only sure-or-unsure, so 0.97 and 0.9 cannot differ between runs", () => {
    const at = (confidence: number) => canonicalize(output({ confidence }) as never, "x").confidence;
    expect(at(0.97)).toBe(at(0.9));
    expect(at(0.7)).toBe(1);
    expect(at(0.69)).toBe(at(0.3));
    expect(at(Number.NaN)).toBe(at(0.1));
  });
  it("tells the model to keep names as written and that last week is 7 days", () => {
    expect(INTERPRETER_SYSTEM).toMatch(/EXACTLY as the user spelled it/);
    expect(INTERPRETER_SYSTEM).toMatch(/"last week" = 7/);
  });
});

describe("sender casing (R16.3)", () => {
  it("uses the casing the user typed, whatever the model returned", () => {
    for (const modelSender of ["iHerb", "iherb", "IHERB"]) {
      expect(canonicalize(output({ sender: modelSender }) as never, "Import ALL iHerb receipts").request.sender).toBe("iHerb");
    }
  });
  it("keeps the model's spelling when the name is not in the message (a known sender)", () => {
    expect(canonicalize(output({ sender: "Adobe" }) as never, "hoe about adobee").request.sender).toBe("Adobe");
  });
});

describe("the model cannot invent what the message did not say (R16.4)", () => {
  const prev: EmailRequest = { action: "list", topic: "receipt", sender: "iherb", days: 30, calendar: null, unread: true, humansOnly: false, exclusion: "" };
  const canon = (overrides: Record<string, unknown>, message: string, previous: EmailRequest | null = null) => canonicalize(output(overrides) as never, message, previous);
  it("drops a real-people filter the message never asked for", () => {
    expect(canon({ humansOnly: true }, "did any recruiter email me today").request.humansOnly).toBe(false);
    expect(canon({ humansOnly: true }, "only real people, not automated").request.humansOnly).toBe(true);
    expect(canon({ humansOnly: true }, "and last week", { ...prev, humansOnly: true }).request.humansOnly).toBe(true);
  });
  it("drops an unread filter or window the message never asked for, unless it was already saved", () => {
    expect(canon({ unread: true }, "show iherb receipts").request.unread).toBe(false);
    expect(canon({ unread: true }, "only unread").request.unread).toBe(true);
    expect(canon({ unread: true }, "from adobe", prev).request.unread).toBe(true);
    expect(canon({ days: 30 }, "show iherb receipts").request.days).toBeNull();
    expect(canon({ days: 30 }, "from adobe", prev).request.days).toBe(30);
    expect(canon({ days: 30 }, "last month").request.days).toBe(30);
  });
  it("never turns a message into an import unless it asks to import, record or save", () => {
    expect(canon({ action: "import_all" }, "show all iherb receipts").request.action).toBe("list");
    expect(canon({ action: "import_all" }, "import them").request.action).toBe("import_all");
    expect(canon({ action: "import" }, "record my latest receipt").request.action).toBe("import");
  });
  it("drops a calendar window the message never named", () => {
    expect(canon({ calendar: "today" }, "show iherb receipts").request.calendar).toBeNull();
    expect(canon({ calendar: "today" }, "emails from google today").request.calendar).toBe("today");
  });
  it("takes the exclusion verbatim from the message, never the model's paraphrase", () => {
    const message = "Emails from PG&E this week, not climate credit or safety notices.";
    for (const paraphrase of ["skip climate credit and safety notices", "not climate credit or safety notices", ""]) {
      expect(canon({ exclusion: paraphrase }, message).request.exclusion).toBe("not climate credit or safety notices.");
    }
  });
  it("carries a saved exclusion into a follow-up only when the model kept one", () => {
    const withExclusion: EmailRequest = { ...prev, exclusion: "not regular Amazon?" };
    expect(canon({ exclusion: "not regular Amazon" }, "and last week", withExclusion).request.exclusion).toBe("not regular Amazon?");
    expect(canon({ exclusion: "" }, "and last week", withExclusion).request.exclusion).toBe("");
    expect(canon({ exclusion: "made up" }, "and last week", null).request.exclusion).toBe("");
  });
  it("matches whole words only, so adobe is not found inside adobee", () => {
    expect(canon({ sender: "Adobe" }, "hoe about adobee").request.sender).toBe("Adobe");
  });
});

describe("actions are grounded in the message (R16.4)", () => {
  const canon = (overrides: Record<string, unknown>, message: string, previous: EmailRequest | null = null) => canonicalize(output(overrides) as never, message, previous);
  const saved = (action: EmailRequest["action"]): EmailRequest => ({ action, topic: "receipt", sender: "iherb", days: null, calendar: null, unread: false, humansOnly: false, exclusion: "" });
  it("amounts or facts need an amount word, else it is a plain list", () => {
    expect(canon({ action: "amounts" }, "show me recent invoices").request.action).toBe("list");
    expect(canon({ action: "facts" }, "show me the latest invoice from adobe").request.action).toBe("list");
    expect(canon({ action: "amounts" }, "show the amounts on my iherb receipts").request.action).toBe("amounts");
  });
  it("facts versus amounts follows the plural and 'latest' rule, whatever the model chose", () => {
    expect(canon({ action: "facts" }, "what are the totals on my iherb receipts").request.action).toBe("amounts");
    expect(canon({ action: "amounts" }, "how much was my latest invoice from Adobe").request.action).toBe("facts");
  });
  it("a follow-up keeps the saved amounts action", () => {
    expect(canon({ action: "amounts" }, "and last week", saved("amounts")).request.action).toBe("amounts");
    expect(canon({ action: "amounts" }, "the amount receipts", saved("list")).request.action).toBe("amounts");
  });
});

describe("clarification noise (R16.3, R16.5)", () => {
  it("keeps the question only when the reading is unsure", () => {
    expect(canonicalize(output({ confidence: 0.9, clarification: "Which sender?" }) as never, "x").clarification).toBeNull();
    expect(canonicalize(output({ confidence: 0.7, clarification: "Which sender?" }) as never, "x").clarification).toBeNull();
    expect(canonicalize(output({ confidence: 0.4, clarification: "Which sender?" }) as never, "x").clarification).toBe("Which sender?");
  });
});
