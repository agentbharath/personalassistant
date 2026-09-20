import { describe, expect, it, vi } from "vitest";
import type { EmailState } from "@/lib/conversations/email-state";
import type { EmailRequest } from "./email-request";
import { INTERPRETER_SYSTEM, INTERPRETER_VERSION, buildInterpreterMessage, canonicalize, interpretEmail, type InterpretationCache, type InterpreterInput } from "./email-interpreter";

const output = (overrides: Record<string, unknown> = {}) => ({
  domain: "email", action: "list", topic: "receipt", sender: "iherb", days: null, calendar: null, unread: false, humansOnly: false,
  exclusion: "", confidence: 0.95, clarification: null, reading: "iherb receipts", pick: 0, pickAction: "none", correction: false, plainList: false, ...overrides,
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
  it("sends the saved request and the numbered results with their dates, and no clock", () => {
    const state: EmailState = { request: { action: "list", topic: "receipt", sender: "iherb", days: null, calendar: null, unread: false, humansOnly: false, exclusion: "" }, results: [{ id: "m1", subject: "Order Confirmed #947597212", from: "iHerb <noreply@info.iherb.com>", date: "Tue, 15 Sep 2026 10:00:00 -0700" }], updatedAt: 123456789 };
    const message = buildInterpreterMessage(input("the amount receipts", state));
    expect(message).toContain('"sender":"iherb"');
    expect(message).toContain('"n":1');
    expect(message).toContain('"date"');
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

describe("code only checks the form of the model's reading (R20.5)", () => {
  const canon = (overrides: Record<string, unknown>, message = "show iherb receipts", results = 0) => canonicalize(output(overrides) as never, message, results);
  it("keeps a sender that is a name or an address, and drops one that is not plausible text", () => {
    expect(canon({ sender: "Amazon Web Services" }).request.sender).toBe("Amazon Web Services");
    expect(canon({ sender: "alice@example.com" }).request.sender).toBe("alice@example.com");
    expect(canon({ sender: "x".repeat(300) }).request.sender).toBeNull();
  });
  it("clamps windows to whole days from 1 to 365 and keeps only one window", () => {
    expect(canon({ days: 9999 }).request.days).toBe(365);
    expect(canon({ days: 0 }).request.days).toBe(1);
    expect(canon({ days: 30.4 }).request.days).toBe(30);
    expect(canon({ days: 30, calendar: "today" }).request).toMatchObject({ days: null, calendar: "today" });
  });
  it("makes imports and amounts receipt requests", () => {
    expect(canon({ action: "import_all", topic: "general" }).request.topic).toBe("receipt");
    expect(canon({ action: "amounts", topic: "promotion" }).request.topic).toBe("receipt");
  });
  it("takes a filter or exclusion the model read, without checking the message for keywords", () => {
    expect(canon({ unread: true, humansOnly: true, exclusion: "not regular Amazon" }).request).toMatchObject({ unread: true, humansOnly: true, exclusion: "not regular Amazon" });
  });
  it("passes a non-email message through untouched (R16.6)", () => {
    expect(canonicalize(output({ domain: "other", sender: "x" }) as never, "what's on my calendar").domain).toBe("other");
  });
});

describe("pointing at a numbered result (R13, R20.5)", () => {
  it("turns the model's 1-based number into a 0-based index with its action", () => {
    expect(canonicalize(output({ pick: 2, pickAction: "import" }) as never, "import the second one", 3).pick).toEqual({ index: 1, action: "import" });
  });
  it("ignores a number outside the list or with no action", () => {
    expect(canonicalize(output({ pick: 5, pickAction: "show" }) as never, "show #5", 3).pick).toBeNull();
    expect(canonicalize(output({ pick: 2, pickAction: "none" }) as never, "x", 3).pick).toBeNull();
    expect(canonicalize(output({ pick: 0, pickAction: "show" }) as never, "show that one", 3).pick).toBeNull();
  });
  it("passes on whether the message corrected the previous reading", () => {
    expect(canonicalize(output({ correction: true }) as never, "I meant the amounts").correction).toBe(true);
  });
});

describe("unsure or failing (R16.5, R16.7)", () => {
  it("returns the clarification and low confidence for the caller to ask", async () => {
    const complete = vi.fn().mockResolvedValue(reply(output({ topic: "general", confidence: 0.4, clarification: "Receipts, promotions, or everything from Adobe?" })));
    const result = await interpretEmail(input("adobe"), { complete });
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.clarification).toMatch(/Receipts, promotions/);
  });
  it.each([["a thrown error", () => Promise.reject(new Error("boom"))], ["not JSON", () => Promise.resolve(reply("nope"))], ["a wrong shape", () => Promise.resolve(reply({ domain: "email" }))]])("reports itself unavailable on %s, and guesses nothing", async (_name, make) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await interpretEmail(input("all iherb recipts"), { complete: make as never });
    expect(result.source).toBe("unavailable");
    expect(result.domain).toBe("other");
    expect(result.request.sender).toBeNull();
    expect(warn).toHaveBeenCalledWith("email_interpreter_unavailable", expect.stringContaining(INTERPRETER_VERSION));
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

describe("clarification noise (R16.3, R16.5)", () => {
  it("keeps the question only when the reading is unsure", () => {
    expect(canonicalize(output({ confidence: 0.9, clarification: "Which sender?" }) as never, "x").clarification).toBeNull();
    expect(canonicalize(output({ confidence: 0.7, clarification: "Which sender?" }) as never, "x").clarification).toBeNull();
    expect(canonicalize(output({ confidence: 0.4, clarification: "Which sender?" }) as never, "x").clarification).toBe("Which sender?");
  });
});
