import type { RouterDecision } from "@/lib/orchestrator/router";

export type RouterExpect = {
  operation: string;
  sender?: string; matter?: string; merchant?: string; term?: string;
  agents?: string[];
  paidOn?: string | null;
  lesson?: Record<string, unknown>;
  /** R25: what kind of draft request. */
  draft?: { action: string; kind?: string | null; replyTo?: string; version?: string; toIncludes?: string; instructionIncludes?: string };
  /** R23: how a redirect should look. `pivot: "none"` means no pivot at all. */
  redirect?: { category?: string; distress?: boolean; pivot?: "none" | string };
  /** R22: the clarifying question should come with two or more tap-to-answer choices. */
  choices?: boolean;
  /** The web search the router wrote: it must include (or leave out) some text, compared without case. */
  searchQueryIncludes?: string;
  searchQueryExcludes?: string;
  /** general_answer only: whether the request wants every saved search result enumerated (R29). */
  listSavedSearches?: boolean;
  /** web_search only: whether two or more separate subjects should each get their own search, instead of being blended into one. */
  splitsIntoSeparateSearches?: boolean;
};

const lower = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : value);

// Things a redirect must never be: a bare refusal, or so short that it cannot contain an offer of help.
const BARE_REFUSAL = /^(sorry[,.!]?\s*)?(i\s+(can'?t|cannot|am unable to|'m unable to|won'?t)\s+(answer|help with|do)\s+(that|this)|that'?s\s+(outside|beyond)\s+(my|what)[^.!?]{0,40})[.!]?$/i;
const MIN_REPLY = 40;

/** Compares the router's decision with what a case expects. Returns the problems found; an empty list means it passed. */
export function checkDecision(decision: RouterDecision | null, want: RouterExpect): string[] {
  if (!decision) return ["router returned null (the model call failed, so nothing was read)"];
  const problems: string[] = [];
  if (decision.operation !== want.operation) problems.push(`operation: wanted ${want.operation}, got ${decision.operation}${decision.clarification ? ` (asked: ${decision.clarification})` : ""}`);
  for (const key of ["sender", "matter", "merchant", "term"] as const) if (want[key] !== undefined && lower(decision[key]) !== lower(want[key])) problems.push(`${key}: wanted ${want[key]}, got ${decision[key]}`);
  if (want.paidOn !== undefined && decision.paidOn !== want.paidOn) problems.push(`paidOn: wanted ${want.paidOn}, got ${decision.paidOn}`);
  if (want.lesson) for (const [key, value] of Object.entries(want.lesson)) if (lower((decision.lesson as Record<string, unknown> | null)?.[key]) !== lower(value)) problems.push(`lesson.${key}: wanted ${String(value)}, got ${String((decision.lesson as Record<string, unknown> | null)?.[key])}`);
  if (want.agents && !want.agents.every((agent) => decision.agents.includes(agent as never))) problems.push(`agents: wanted ${want.agents.join(",")}, got ${decision.agents.join(",")}`);

  if (want.draft) {
    if (decision.draft?.action !== want.draft.action) problems.push(`draft.action: wanted ${want.draft.action}, got ${decision.draft?.action ?? "none"}`);
    if (want.draft.kind !== undefined && decision.draft?.kind !== want.draft.kind) problems.push(`draft.kind: wanted ${want.draft.kind}, got ${decision.draft?.kind ?? "none"}`);
  }

  if (want.draft?.replyTo !== undefined && (decision.draft?.replyTo ?? "") !== want.draft.replyTo) problems.push(`draft.replyTo: wanted ${want.draft.replyTo}, got ${decision.draft?.replyTo ?? ""}`);
  if (want.draft?.version !== undefined && (decision.draft?.version ?? "") !== want.draft.version) problems.push(`draft.version: wanted ${want.draft.version}, got ${decision.draft?.version ?? ""}`);
  if (want.draft?.toIncludes && !(decision.draft?.to ?? "").toLowerCase().includes(want.draft.toIncludes.toLowerCase())) problems.push(`draft.to: wanted it to include ${want.draft.toIncludes}, got ${decision.draft?.to ?? ""}`);

  if (want.draft?.instructionIncludes && !(decision.draft?.instruction ?? "").toLowerCase().includes(want.draft.instructionIncludes.toLowerCase())) problems.push(`draft.instruction: wanted it to include ${want.draft.instructionIncludes}, got ${decision.draft?.instruction ?? ""}`);

  if (want.choices && (decision.choices?.length ?? 0) < 2) problems.push(`choices: wanted two or more tap-to-answer choices, got ${decision.choices?.length ?? 0}`);

  if (want.searchQueryIncludes && !(decision.searchQuery ?? "").toLowerCase().includes(want.searchQueryIncludes.toLowerCase())) problems.push(`searchQuery: wanted it to include ${want.searchQueryIncludes}, got ${JSON.stringify(decision.searchQuery ?? "")}`);
  if (want.searchQueryExcludes && (decision.searchQuery ?? "").toLowerCase().includes(want.searchQueryExcludes.toLowerCase())) problems.push(`searchQuery: should not include ${want.searchQueryExcludes}, got ${JSON.stringify(decision.searchQuery)}`);
  if (want.listSavedSearches !== undefined && Boolean(decision.listSavedSearches) !== want.listSavedSearches) problems.push(`listSavedSearches: wanted ${want.listSavedSearches}, got ${Boolean(decision.listSavedSearches)}`);
  if (want.splitsIntoSeparateSearches !== undefined) {
    const split = (decision.searchQueries?.length ?? 0) >= 2;
    if (split !== want.splitsIntoSeparateSearches) problems.push(`splitsIntoSeparateSearches: wanted ${want.splitsIntoSeparateSearches}, got ${split} (searchQueries: ${JSON.stringify(decision.searchQueries)})`);
  }

  // Every redirect, whatever else is expected of it (R23): a real message, not a bare refusal.
  if (decision.operation === "redirect") {
    const plan = decision.redirect;
    const reply = plan?.reply ?? "";
    if (reply.trim().length < MIN_REPLY) problems.push(`redirect.reply: too short to help (${reply.trim().length} characters)`);
    if (BARE_REFUSAL.test(reply.trim())) problems.push(`redirect.reply: a bare refusal ("${reply.trim().slice(0, 60)}")`);
    if (plan?.distress && plan.pivot) problems.push("redirect: a task pivot was offered to someone in distress");
    if (want.redirect?.category && plan?.category !== want.redirect.category) problems.push(`redirect.category: wanted ${want.redirect.category}, got ${plan?.category}`);
    if (want.redirect?.distress !== undefined && Boolean(plan?.distress) !== want.redirect.distress) problems.push(`redirect.distress: wanted ${want.redirect.distress}, got ${Boolean(plan?.distress)}`);
    if (want.redirect?.pivot === "none" && plan?.pivot) problems.push(`redirect.pivot: wanted none, got ${plan.pivot.capability}`);
    if (want.redirect?.pivot && want.redirect.pivot !== "none" && plan?.pivot?.capability !== want.redirect.pivot) problems.push(`redirect.pivot: wanted ${want.redirect.pivot}, got ${plan?.pivot?.capability ?? "none"}`);
  } else if (want.redirect) {
    problems.push("redirect: expected a redirect");
  }
  return problems;
}
