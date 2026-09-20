import { describe, expect, it } from "vitest";
import type { RouterDecision } from "@/lib/orchestrator/router";
import { checkDecision } from "./router-check";

const decision = (over: Partial<RouterDecision>): RouterDecision => ({ operation: "email", agents: [], sender: null, matter: null, merchant: null, paidOn: null, term: null, lesson: null, confidence: 1, clarification: null, reading: "", source: "model", ...over });
const plan = (over: Record<string, unknown> = {}) => ({ category: "speculation" as const, reply: "I can't tell you how they came by theirs, but I can help you find vintage shops near you.", pivot: { capability: "web" as const, ask: null }, distress: false, ...over });

describe("grading a router decision (free; a wrong grader would waste credits)", () => {
  it("passes a matching operation and fails a different one", () => {
    expect(checkDecision(decision({ operation: "email" }), { operation: "email" })).toEqual([]);
    expect(checkDecision(decision({ operation: "web_search" }), { operation: "email" })[0]).toMatch(/wanted email, got web_search/);
    expect(checkDecision(null, { operation: "email" })[0]).toMatch(/returned null/);
  });

  it("checks drafts by action and kind", () => {
    const draft = { action: "create" as const, kind: "reply" as const, to: "sarah", replyTo: null, instruction: "yes", version: null };
    expect(checkDecision(decision({ operation: "email_draft", draft }), { operation: "email_draft", draft: { action: "create", kind: "reply" } })).toEqual([]);
    expect(checkDecision(decision({ operation: "email_draft", draft }), { operation: "email_draft", draft: { action: "edit" } })[0]).toMatch(/draft.action/);
    expect(checkDecision(decision({ operation: "email_draft", draft }), { operation: "email_draft", draft: { action: "create", kind: "new" } })[0]).toMatch(/draft.kind/);
  });

  it("requires tap-to-answer choices when a case asks for them", () => {
    expect(checkDecision(decision({ operation: "clarify", choices: ["3 AM", "3 PM"] }), { operation: "clarify", choices: true })).toEqual([]);
    expect(checkDecision(decision({ operation: "clarify", choices: null }), { operation: "clarify", choices: true })[0]).toMatch(/choices/);
  });

  it("accepts a good redirect and checks its category and pivot", () => {
    const good = decision({ operation: "redirect", redirect: plan() });
    expect(checkDecision(good, { operation: "redirect", redirect: { category: "speculation", pivot: "web" } })).toEqual([]);
    expect(checkDecision(good, { operation: "redirect", redirect: { category: "contested" } })[0]).toMatch(/redirect.category/);
    expect(checkDecision(good, { operation: "redirect", redirect: { pivot: "none" } })[0]).toMatch(/wanted none/);
  });

  it("fails a redirect that is a bare refusal or too short to help, whatever else is expected", () => {
    for (const reply of ["I can't answer that.", "Sorry, I can't answer that!", "That's outside my scope.", "I can't help with that.", "No."]) {
      expect(checkDecision(decision({ operation: "redirect", redirect: plan({ reply }) }), { operation: "redirect" }).join(" "), reply).toMatch(/redirect.reply/);
    }
  });

  it("fails a task pivot offered to someone in distress, and checks the distress flag", () => {
    const upset = decision({ operation: "redirect", redirect: plan({ category: "emotional", distress: true, reply: "That really hurts, and I'm sorry. I'm here if you want to talk it through." }) });
    expect(checkDecision(upset, { operation: "redirect", redirect: { category: "emotional", distress: true, pivot: "none" } })[0]).toMatch(/task pivot was offered/);
    const kind = decision({ operation: "redirect", redirect: plan({ category: "emotional", distress: true, pivot: null, reply: "That really hurts, and I'm sorry. I'm here if you want to talk it through." }) });
    expect(checkDecision(kind, { operation: "redirect", redirect: { distress: true, pivot: "none" } })).toEqual([]);
    expect(checkDecision(kind, { operation: "redirect", redirect: { distress: false } })[0]).toMatch(/redirect.distress/);
  });

  it("fails when a redirect was expected but another operation came back", () => {
    expect(checkDecision(decision({ operation: "casual" }), { operation: "redirect", redirect: { category: "contested" } }).join(" ")).toMatch(/wanted redirect, got casual/);
  });

  it("checks that the search the router wrote does or does not include a place", () => {
    const search = decision({ operation: "web_search", searchQuery: "Indian restaurants in Sunnyvale, CA" } as never);
    expect(checkDecision(search, { operation: "web_search", searchQueryIncludes: "sunnyvale" })).toEqual([]);
    expect(checkDecision(search, { operation: "web_search", searchQueryIncludes: "Oakland" })[0]).toMatch(/wanted it to include Oakland/);
    expect(checkDecision(search, { operation: "web_search", searchQueryExcludes: "Sunnyvale" })[0]).toMatch(/should not include Sunnyvale/);
    expect(checkDecision(decision({ operation: "web_search" }), { operation: "web_search", searchQueryIncludes: "Sunnyvale" })[0]).toMatch(/wanted it to include/);
  });
});
