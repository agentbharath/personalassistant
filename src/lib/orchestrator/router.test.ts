import { describe, expect, it, vi } from "vitest";
import type { InterpretationCache } from "@/lib/agents/email-interpreter";
import type { EmailState } from "@/lib/conversations/email-state";
import { ROUTER_SYSTEM, ROUTER_VERSION, buildRouterMessage, canonicalizeDecision, routeMessage, type RouterInput } from "./router";

const out = (over: Record<string, unknown> = {}) => ({ operation: "email", agents: [], sender: null, matter: null, merchant: null, paidOn: null, term: null, lesson: null, confidence: 0.95, clarification: null, reading: "x", ...over });
const lessonOf = (over: Record<string, unknown>) => ({ kind: "default_window", topic: null, days: null, minutes: null, merchant: null, category: null, alias: null, canonical: null, ...over });
const reply = (value: unknown) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] }) as never;
const input = (message: string, over: Partial<RouterInput> = {}): RouterInput => ({ userId: "u1", message, context: [], emailState: null, today: "2026-09-21", pendingApproval: false, ...over });
const cacheOf = (): InterpretationCache & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return { store, get: async (key) => store.get(key) ?? null, set: async (key, value) => { store.set(key, value); } };
};
const canon = (over: Record<string, unknown>) => canonicalizeDecision(out(over) as never);

describe("what the router is asked (R19.2, R19.7)", () => {
  it("uses temperature 0, a schema, the versioned prompt, and no tools", async () => {
    const complete = vi.fn().mockResolvedValue(reply(out()));
    await routeMessage(input("all iherb recipts"), { complete });
    const params = complete.mock.calls[0][0];
    expect(params.temperature).toBe(0);
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.system).toBe(ROUTER_SYSTEM);
    expect(params.tools).toBeUndefined();
    expect(ROUTER_VERSION).toMatch(/^router-v\d+$/);
  });
  it("gives the model today's date, the pending-approval flag, the last turns, and the saved email search", () => {
    const state: EmailState = { request: { action: "list", topic: "receipt", sender: "iherb", days: 365, calendar: null, unread: false, humansOnly: false, exclusion: "" }, results: [{ id: "m", subject: "Order Confirmed", from: "iHerb", date: "Tue, 15 Sep 2026" }], updatedAt: 123456 };
    const message = buildRouterMessage(input("import them", { emailState: state, pendingApproval: true, context: [{ role: "user", content: "all iherb receipts" }] }));
    expect(message).toContain('"today":"2026-09-21"');
    expect(message).toContain('"pendingApproval":true');
    expect(message).toContain('"sender":"iherb"');
    expect(message).toContain("all iherb receipts");
    expect(message).not.toContain("123456");
  });
  it("tells the model that it, and nothing else, reads dates, places and typos", () => {
    expect(ROUTER_SYSTEM).toMatch(/You interpret the user's words yourself, including typos, shorthand, dates and places; nothing else does/);
  });
});

describe("the same input resolves the same way (R19.7)", () => {
  it("answers a repeat from the cache, and keys on the saved state, the user and the day", async () => {
    const complete = vi.fn().mockResolvedValue(reply(out()));
    const cache = cacheOf();
    expect((await routeMessage(input("all iherb recipts"), { complete, cache }))?.source).toBe("model");
    expect((await routeMessage(input("  ALL iherb   recipts "), { complete, cache }))?.source).toBe("cache");
    expect(complete).toHaveBeenCalledTimes(1);
    await routeMessage({ ...input("all iherb recipts"), userId: "u2" }, { complete, cache });
    await routeMessage(input("all iherb recipts", { today: "2026-09-22" }), { complete, cache });
    await routeMessage(input("all iherb recipts", { pendingApproval: true }), { complete, cache });
    expect(complete).toHaveBeenCalledTimes(4);
  });
});

describe("failure falls back to the rules (R19.8)", () => {
  it.each([["a thrown error", () => Promise.reject(new Error("boom"))], ["not JSON", () => Promise.resolve(reply("nope"))], ["a wrong shape", () => Promise.resolve(reply({ operation: "email" }))], ["an unknown operation", () => Promise.resolve(reply(out({ operation: "launch_rocket" })))]])("returns null on %s, and caches nothing", async (_name, make) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cache = cacheOf();
    expect(await routeMessage(input("x"), { complete: make as never, cache })).toBeNull();
    expect(cache.store.size).toBe(0);
    expect(warn).toHaveBeenCalledWith("router_fallback", expect.stringContaining(ROUTER_VERSION));
    warn.mockRestore();
  });
  it("a broken cache never blocks an answer", async () => {
    const complete = vi.fn().mockResolvedValue(reply(out()));
    const broken: InterpretationCache = { get: () => Promise.reject(new Error("down")), set: () => Promise.reject(new Error("down")) };
    expect((await routeMessage(input("x"), { complete, cache: broken }))?.source).toBe("model");
  });
});

describe("code checks structure and never judges the message (R19.5)", () => {
  it("does not even receive the user's message, so it cannot override what the model understood", () => {
    expect(canonicalizeDecision.length).toBe(1);
    expect(canon({ operation: "bills_paid", merchant: "PG&E" }).operation).toBe("bills_paid");
    expect(canon({ operation: "calendar_delete" }).operation).toBe("calendar_delete");
    expect(canon({ operation: "email_write_declined" }).operation).toBe("email_write_declined");
    expect(canon({ operation: "unsafe" }).operation).toBe("unsafe");
  });
  it("asks when a field the operation needs is missing", () => {
    expect(canon({ operation: "status_lookup", sender: "chase", matter: "dispute" })).toMatchObject({ operation: "status_lookup", sender: "chase", matter: "dispute" });
    expect(canon({ operation: "status_lookup", sender: "chase", matter: null }).operation).toBe("clarify");
    expect(canon({ operation: "bills_paid", merchant: null }).operation).toBe("clarify");
    expect(canon({ operation: "bills_autopay", merchant: null }).operation).toBe("clarify");
    expect(canon({ operation: "multi", agents: ["email"] }).operation).toBe("clarify");
    expect(canon({ operation: "multi", agents: ["calendar", "email", "email"] })).toMatchObject({ operation: "multi", agents: ["calendar", "email"] });
  });
  it("keeps a date only in the ISO form the model was asked for", () => {
    expect(canon({ operation: "bills_paid", merchant: "PG&E", paidOn: "2026-09-20" }).paidOn).toBe("2026-09-20");
    expect(canon({ operation: "bills_paid", merchant: "PG&E", paidOn: "last Sunday" }).paidOn).toBeNull();
    expect(canon({ operation: "bills_paid", merchant: "PG&E", paidOn: null }).paidOn).toBeNull();
  });
  it("forgetting may or may not name a thing", () => {
    expect(canon({ operation: "learning_forget", term: "adobee" }).term).toBe("adobee");
    expect(canon({ operation: "learning_forget", term: null }).term).toBeNull();
  });
  it.each([
    [lessonOf({ kind: "merchant_category", merchant: "iherb", category: "health" }), { kind: "merchant_category", merchant: "iherb", category: "health" }],
    [lessonOf({ kind: "default_window", topic: "receipt", days: 90 }), { kind: "default_window", topic: "receipt", days: 90 }],
    [lessonOf({ kind: "default_window", days: 9999 }), { kind: "default_window", topic: "all", days: 365 }],
    [lessonOf({ kind: "calendar_duration", minutes: 30 }), { kind: "calendar_duration", minutes: 30 }],
    [lessonOf({ kind: "calendar_buffer", minutes: 500 }), { kind: "calendar_buffer", minutes: 120 }],
    [lessonOf({ kind: "receipts_show_amounts" }), { kind: "receipts_show_amounts" }],
    [lessonOf({ kind: "sender_alias", alias: "adobee", canonical: "Adobe" }), { kind: "sender_alias", alias: "adobee", canonical: "Adobe" }],
    [lessonOf({ kind: "merchant_alias", alias: "amzn", canonical: "Amazon" }), { kind: "merchant_alias", alias: "amzn", canonical: "Amazon" }],
    [lessonOf({ kind: "autopay", merchant: "PG&E" }), { kind: "autopay", merchant: "PG&E" }],
  ])("a lesson is kept as the model read it: %#", (lesson, want) => {
    expect(canon({ operation: "learning_teach", lesson }).lesson).toEqual(want);
  });
  it.each([
    lessonOf({ kind: "merchant_category", merchant: "iherb", category: null }), lessonOf({ kind: "default_window", days: null }),
    lessonOf({ kind: "sender_alias", alias: "x", canonical: null }), lessonOf({ kind: "calendar_duration", minutes: null }), lessonOf({ kind: "autopay", merchant: null }),
  ])("a lesson missing what it needs becomes a question: %#", (lesson) => {
    expect(canon({ operation: "learning_teach", lesson })).toMatchObject({ operation: "clarify", clarification: expect.stringMatching(/remember/) });
  });
  it("a teaching with no lesson at all becomes a question", () => {
    expect(canon({ operation: "learning_teach", lesson: null }).operation).toBe("clarify");
  });
  it("keeps the clarification only when unsure, and gives a default question for clarify", () => {
    expect(canon({ confidence: 0.9, clarification: "Which?" }).clarification).toBeNull();
    expect(canon({ confidence: 0.4, clarification: "Which?" })).toMatchObject({ clarification: "Which?", confidence: 0.4 });
    expect(canon({ operation: "clarify", confidence: 0.4, clarification: null }).clarification).toMatch(/say a bit more/);
  });
  it("reduces confidence to sure or unsure", () => {
    expect(canon({ confidence: 0.97 }).confidence).toBe(canon({ confidence: 0.9 }).confidence);
  });
});
