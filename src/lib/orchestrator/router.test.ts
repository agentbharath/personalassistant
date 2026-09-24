import { describe, expect, it, vi } from "vitest";
import type { InterpretationCache } from "@/lib/agents/email-interpreter";
import type { EmailState } from "@/lib/conversations/email-state";
import { ROUTER_SYSTEM, ROUTER_VERSION, buildRouterMessage, canonicalizeDecision, routeMessage, routerCacheMaterial, type RouterInput } from "./router";

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
    expect(params.system).toEqual([{ type: "text", text: ROUTER_SYSTEM, cache_control: { type: "ephemeral" } }]);
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
    expect(warn).toHaveBeenCalledWith("router_unavailable", expect.stringContaining(ROUTER_VERSION));
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
  it("keeps the search the model wrote for a web search, and drops it for anything else", () => {
    expect(canon({ operation: "web_search", searchQuery: "  Indian restaurants in Sunnyvale, CA  " }).searchQuery).toBe("Indian restaurants in Sunnyvale, CA");
    expect(canon({ operation: "web_search", searchQuery: "" }).searchQuery).toBeNull();
    expect(canon({ operation: "email", searchQuery: "ignored" }).searchQuery).toBeUndefined();
  });
  it("tells the model to put the saved home place in a near-me search, to let a named place win, and to ask when no place is saved", () => {
    expect(ROUTER_SYSTEM).toMatch(/searchQuery/);
    expect(ROUTER_SYSTEM).toMatch(/homeLocation is given, put that place in the query/);
    expect(ROUTER_SYSTEM).toMatch(/a place the person names always wins/);
    expect(ROUTER_SYSTEM).toMatch(/homeLocation is null, do not guess a city: choose clarify/);
  });
  it("reduces confidence to sure or unsure", () => {
    expect(canon({ confidence: 0.97 }).confidence).toBe(canon({ confidence: 0.9 }).confidence);
  });
});

import { ROUTER_JSON_SCHEMA } from "./router";

describe("router v14: drafts, redirects and choices (R22, R23, R25)", () => {
  // The model returns flat objects with "none" and empty strings, not nulls (the API limits how many union-typed fields a schema may have).
  const draft = (over: Record<string, unknown> = {}) => ({ action: "create", kind: "reply", to: "sarah", replyTo: "sarah's email", instruction: "say I'll be there", version: "", ...over });
  const redirect = (over: Record<string, unknown> = {}) => ({ category: "speculation", reply: "I can't tell you how they came by theirs, but I can help you find vintage shops near you.", distress: false, pivot: "web", ask: "", ...over });
  const noDraft = { action: "none", kind: "none", to: "", replyTo: "", instruction: "", version: "" };
  const noRedirect = { category: "none", reply: "", distress: false, pivot: "none", ask: "" };

  it("stays inside the API's limit on union-typed fields, so the request is never rejected (free check)", () => {
    // Anthropic rejects a structured-output schema with more than 16 parameters that use anyOf or a type array. This once cost a whole failed run.
    let unions = 0;
    const walk = (node: unknown) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if ("anyOf" in record || Array.isArray(record.type)) unions += 1;
        Object.values(record).forEach(walk);
      }
    };
    walk(ROUTER_JSON_SCHEMA);
    expect(unions).toBeLessThanOrEqual(16);
  });

  it("requires every field, so the model always fills them", () => {
    const required = ROUTER_JSON_SCHEMA.required as readonly string[];
    for (const key of ["choices", "draft", "redirect"]) expect(required).toContain(key);
  });

  it("is version 14, asks when in doubt, and teaches drafting, redirecting and choices", () => {
    expect(ROUTER_VERSION).toBe("router-v23");
    expect(ROUTER_SYSTEM).toMatch(/When in doubt, ask/);
    expect(ROUTER_SYSTEM).toMatch(/email_draft/);
    expect(ROUTER_SYSTEM).toMatch(/Never just "I can't answer that"/);
    expect(ROUTER_SYSTEM).toMatch(/one-time codes and links alone/);
  });

  it("reads a draft request into its parts, and asks when the draft details are missing", () => {
    expect(canon({ operation: "email_draft", draft: draft() })).toMatchObject({ operation: "email_draft", draft: { action: "create", kind: "reply", to: "sarah" } });
    expect(canon({ operation: "email_draft", draft: noDraft })).toMatchObject({ operation: "clarify" });
    expect(canon({ operation: "email_draft", draft: null })).toMatchObject({ operation: "clarify" });
    expect(canon({ operation: "email_draft", draft: draft({ action: "revert", kind: "none", to: "", replyTo: "", version: "the first one" }) }).draft).toMatchObject({ action: "revert", kind: null, to: null, version: "the first one" });
  });

  it("keeps a redirect's message and a real pivot", () => {
    expect(canon({ operation: "redirect", redirect: redirect() })).toMatchObject({ operation: "redirect", redirect: { category: "speculation", distress: false, pivot: { capability: "web", ask: null } } });
    expect(canon({ operation: "redirect", redirect: redirect({ ask: "Which city or ZIP?" }) }).redirect?.pivot).toEqual({ capability: "web", ask: "Which city or ZIP?" });
    expect(canon({ operation: "redirect", redirect: redirect({ pivot: "none" }) }).redirect?.pivot).toBeNull();
  });

  it("never sends a task pivot to someone in distress, whatever the model returned", () => {
    expect(canon({ operation: "redirect", redirect: redirect({ category: "emotional", distress: true }) }).redirect).toMatchObject({ distress: true, pivot: null });
  });

  it("never turns a redirect into a bare refusal: a missing message is replaced with real help", () => {
    const plan = canon({ operation: "redirect", redirect: redirect({ reply: "   " }) }).redirect!;
    expect(plan.reply).not.toMatch(/^I can'?t answer that\.?$/i);
    expect(plan.reply).toMatch(/email, calendar and spending/);
    expect(canon({ operation: "redirect", redirect: null }).redirect?.reply).toMatch(/email, calendar and spending/);
    expect(canon({ operation: "redirect", redirect: noRedirect }).redirect).toMatchObject({ category: "unrelated" });
  });

  it("offers two to six distinct, short choices, or none", () => {
    expect(canon({ operation: "clarify", confidence: 0.4, clarification: "3 AM or 3 PM?", choices: ["3 AM", "3 PM"] }).choices).toEqual(["3 AM", "3 PM"]);
    expect(canon({ operation: "clarify", confidence: 0.4, clarification: "Which?", choices: ["Only one"] }).choices).toBeNull();
    expect(canon({ operation: "clarify", confidence: 0.4, clarification: "Which?", choices: ["a", "a", "b", "c", "d", "e", "f", "g", "h"] }).choices).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(canon({ operation: "clarify", confidence: 0.4, clarification: "Which?", choices: [] }).choices).toBeNull();
  });

  it("treats confidence below 0.8 as doubt, so it asks", () => {
    expect(canon({ confidence: 0.79, clarification: "Which one?" })).toMatchObject({ confidence: 0.4, clarification: "Which one?" });
    expect(canon({ confidence: 0.8, clarification: "Which one?" }).clarification).toBeNull();
  });

  it("reads the new fields from the model's answer, and tolerates an answer without them", async () => {
    const complete = vi.fn().mockResolvedValueOnce(reply(out({ operation: "redirect", redirect: redirect(), choices: [], draft: noDraft })))
      .mockResolvedValueOnce(reply(out({ operation: "email" })));
    expect((await routeMessage(input("how come people own vintage items but not me"), { complete }))?.redirect?.category).toBe("speculation");
    expect((await routeMessage(input("all iherb receipts"), { complete }))?.operation).toBe("email");
  });
});

describe("the saved home location (free)", () => {
  it("is given to the router so it can read near me, and is null when nothing is saved", () => {
    expect(buildRouterMessage(input("yes please", { homeLocation: "Oakland, CA" }))).toContain('"homeLocation":"Oakland, CA"');
    expect(buildRouterMessage(input("yes please"))).toContain('"homeLocation":null');
  });
  it("changes the cache key, so an answer read without a home is never reused after one is saved", () => {
    const keyOf = (home?: string) => routerCacheMaterial(input("yes please", { homeLocation: home ?? null }));
    expect(keyOf("Oakland, CA")).not.toBe(keyOf());
  });
  it("tells the model what to do with it", () => {
    expect(ROUTER_SYSTEM).toMatch(/homeLocation is the user's saved home city or ZIP/);
  });
});

describe("how much of the conversation the router sees (free)", () => {
  const input = (context: RouterInput["context"]): RouterInput => ({ userId: "u1", message: "I can't attend", context, emailState: null, today: "2026-09-21", pendingApproval: false });

  it("keeps the last twelve messages, with room for a whole list or draft in Daylark's own answers", () => {
    const context = Array.from({ length: 12 }, (_, index) => ({ role: (index % 2 ? "assistant" : "user") as "user" | "assistant", content: `${index}:` + "x".repeat(1000) }));
    const recent = JSON.parse(buildRouterMessage(input(context))).recent as Array<{ role: string; text: string }>;
    expect(recent).toHaveLength(12);
    expect(recent[0].text.startsWith("0:")).toBe(true);
    expect(recent.filter((item) => item.role === "assistant").every((item) => item.text.length > 900)).toBe(true);
    expect(recent.filter((item) => item.role === "user").every((item) => item.text.length > 900)).toBe(true);
  });

  it("passes the summary of earlier conversation separately, so it never uses up a recent slot", () => {
    const message = JSON.parse(buildRouterMessage(input([{ role: "assistant", content: "Earlier conversation summary:\nThe person is planning a trip." }, { role: "user", content: "hi" }])));
    expect(message.summary).toContain("planning a trip");
    expect(message.recent).toEqual([{ role: "user", text: "hi" }]);
  });

  it("tells the model that an answer to its own question continues the same task, and that reply-to-a-person starts a new reply", () => {
    expect(ROUTER_SYSTEM).toMatch(/is the ANSWER to it and continues the same task/);
    expect(ROUTER_SYSTEM).toMatch(/always starts a NEW reply or email, even right after a draft was saved/);
  });
});


describe("context repair for an answered clarification",()=>{
  it("reviews a repeated question once, then executes the clarified operation",async()=>{
    const complete=vi.fn().mockResolvedValueOnce(reply(out({operation:"clarify",confidence:0.4,clarification:"Daylark drafts or Gmail drafts?"})))
      .mockResolvedValueOnce(reply(out({operation:"email_draft_history"})));
    const result=await routeMessage(input("Daylark's saved drafts",{context:[{role:"user",content:"What emails have we drafted?"},{role:"assistant",content:"Daylark drafts or Gmail drafts?"}]}),{complete});
    expect(result?.operation).toBe("email_draft_history");
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("does not loop indefinitely if a genuine clarification remains necessary",async()=>{
    const complete=vi.fn().mockResolvedValue(reply(out({operation:"clarify",confidence:0.4,clarification:"3 AM or 3 PM?"})));
    expect((await routeMessage(input("three",{context:[{role:"assistant",content:"When should we meet?"}]}),{complete}))?.operation).toBe("clarify");
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("preserves an offer at the end of a long answer and includes it in the cache key",()=>{
    const question="Want me to search for JavaScript sudoku solver code?";
    const context=[{role:"assistant" as const,content:"Background. ".repeat(500)+question}];
    const message=JSON.parse(buildRouterMessage(input("Yes",{context})));
    expect(message.lastAssistantTurn).toContain(question);
    expect(message.recent[0].text).toContain(question);
    expect(routerCacheMaterial(input("Yes",{context}))).not.toBe(routerCacheMaterial(input("Yes",{context:[{role:"assistant",content:"Background. ".repeat(500)+"Want resume templates?"}]})));
  });
});

describe("follow-up loop protection", () => {
  it("blocks a repeated answered choice after one repair without caching the failure", async () => {
    const question = "Daylark drafts or Gmail drafts?";
    const complete = vi.fn().mockResolvedValue(reply(out({operation:"clarify", confidence:0.4, clarification:question})));
    const cache = cacheOf();
    const result = await routeMessage(input("Daylark drafts", {context:[{role:"assistant", content:question, choices:["Daylark drafts", "Gmail drafts"]}]}), {complete, cache});
    expect(result).toMatchObject({continuityBlocked:true, choices:[]});
    expect(result?.clarification).not.toContain(question);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(cache.store.size).toBe(0);
  });
  it("reviews an accepted offer even when the offer ends in a period", async () => {
    const complete = vi.fn().mockResolvedValueOnce(reply(out({operation:"clarify", confidence:0.4, clarification:"Search for what?"}))).mockResolvedValueOnce(reply(out({operation:"web_search", searchQuery:"JavaScript sudoku solver"})));
    const result = await routeMessage(input("Yes", {pendingApproval:true, context:[{role:"assistant", content:"I can search for JavaScript sudoku solver code."}]}), {complete});
    expect(result?.operation).toBe("web_search");
    const sent = JSON.parse(complete.mock.calls[0][0].messages[0].content);
    expect(sent.followupExchange.assistantReply).toContain("sudoku");
    expect(ROUTER_SYSTEM).not.toContain("trust the flag over what recent contains");
  });
});
