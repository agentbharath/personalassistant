import { financeFreshness } from "@/lib/finance-sync/review";
import { answerDraftHistory } from "@/lib/agents/draft-history";
import { continueEmailFinanceImport } from "@/lib/agents/email-finance-import";
import { cancelEmailScan } from "@/lib/workflows/email-scan";
import { answerCalendar } from "@/lib/agents/calendar";
import { prepareCalendarCreate } from "@/lib/agents/calendar-create";
import { answerFinance } from "@/lib/agents/finance";
import { answerPublicSearch, type RememberSearch } from "@/lib/agents/general";
import { runBillsCommand } from "@/lib/agents/bills-agent";
import { answerStatusLookup } from "@/lib/agents/status-lookup";
import { acknowledgeLearning } from "@/lib/learning/commands";
import type { Learning } from "@/lib/learning/learnings";
import { saveLearning } from "@/lib/learning/store";
import { answerCasual, answerGeneral } from "@/lib/model/claude";
import { prepareAgentStage } from "@/lib/runtime/query-budget";
import { prepareCalendarAttendeeUpdate, prepareCalendarDelete, resolvePendingCalendarAttendeeUpdate, resolvePendingCalendarCreate, resolvePendingCalendarDelete } from "@/lib/workflows/calendar-create";
import { resolvePendingFinanceImport } from "@/lib/workflows/finance-import";
import { handleEmailConversationTurn } from "./email-turn";
import { answerScheduleFeasibility } from "./feasibility";
import { loadRecentSearchStates, renderSearchHistory, saveSearchState } from "@/lib/conversations/search-state";
import { buildMemoryContext } from "@/lib/memory/context";
import { findMatchingMemories, renderMemories } from "@/lib/memory/commands";
import { extractMemoriesForUser } from "@/lib/memory/extractor-runtime";
import { createMemory, forgetMemory, listMemories, supersedeMemory } from "@/lib/memory/store";
import { answerDailyView } from "@/lib/today/answer";
import { runLearningCommand } from "./learning-turn";
import { composeMultiAgentAnswer, executeReadOnlyAgentPlan, planClauseInstructions } from "./multi-agent";
import { ROUTER_CONFIDENCE_THRESHOLD, type ContextMessage, type Lesson, type RouterDecision } from "./router";
import { CRISIS_RESPONSE } from "./scope";
import { UNSAFE_REFUSAL } from "./safety";
import { EMAIL_READ_ONLY_NOTICE } from "./routing";
import type { OrchestratorResult } from "./run";
import { reportFailure } from "@/lib/observability/report";
import { prepareEmailDraft } from "@/lib/agents/email-draft";
import { loadEmailState } from "@/lib/conversations/email-state";
import { resolvePendingEmailDraft } from "@/lib/workflows/email-draft";
import { ownerIdentity } from "@/lib/auth/owner";

export type DispatchContext = { requestId: string; input: string; userId: string; context: ContextMessage[]; conversationId?: string };

/** An answer is always text. If a handler ever hands back anything else, say so plainly and report it, instead of showing "[object Object]". */
export const NOT_TEXT = "I had trouble putting that answer together, so nothing was shown. Please ask again.";
function asText(answer: unknown, operation: string) {
  if (typeof answer === "string" && answer.trim()) return answer;
  reportFailure("answer_not_text", { name: "TypeError" }, { operation });
  return NOT_TEXT;
}

export const NOTHING_PENDING = "There's nothing waiting for your approval right now.";
const FORGET_ALL_PROMPT = "Say “yes, forget everything” to confirm.";

/** The model read what the user taught; this only maps it onto what is stored. */
function lessonToLearning(lesson: Lesson): Learning {
  switch (lesson.kind) {
    case "default_window": return { kind: "default_window", topic: lesson.topic, days: lesson.days };
    case "receipts_show_amounts": return { kind: "default_action", topic: "receipt", action: "amounts" };
    case "sender_alias": return { kind: "sender_alias", alias: lesson.alias, canonical: lesson.canonical };
    case "calendar_duration": return { kind: "calendar_duration", minutes: lesson.minutes };
    case "calendar_buffer": return { kind: "calendar_buffer", minutes: lesson.minutes };
    case "merchant_category": return { kind: "merchant_category", merchant: lesson.merchant, category: lesson.category };
    case "merchant_alias": return { kind: "merchant_alias", alias: lesson.alias, canonical: lesson.canonical };
    case "autopay": return { kind: "autopay", merchant: lesson.merchant };
  }
}

/** Approve or deny goes to whichever approval is waiting, in the same order as before. The model decided the user meant yes or no. */
export async function answerApproval(approve: boolean, userId: string, conversationId: string | undefined) {
  if (!conversationId) return null;
  const word = approve ? "confirm" : "cancel";
  const resolvers: Array<[string, () => Promise<{ answer: string; status: "completed" | "waiting_for_user" } | null>]> = [
    ["calendar", () => resolvePendingCalendarDelete(userId, conversationId, word)],
    ["calendar", () => resolvePendingCalendarAttendeeUpdate(userId, conversationId, word)],
    ["calendar", () => resolvePendingCalendarCreate(userId, conversationId, word)],
    ["finance", () => resolvePendingFinanceImport(userId, conversationId, word)],
    ["email", () => resolvePendingEmailDraft(userId, conversationId, word)],
  ];
  for (const [agent, resolve] of resolvers) {
    const outcome = await resolve();
    if (outcome) {
      if (!approve && agent === "finance") await cancelEmailScan(userId, conversationId);
      return { ...outcome, agents: [agent] };
    }
  }
  const cancelledScan = approve ? false : await cancelEmailScan(userId, conversationId);
  return cancelledScan ? { answer: "Scan cancelled. No additional transactions were imported.", agents: ["email", "finance"], status: "completed" as const } : null;
}
const NEEDS_CONVERSATION = "I need a saved conversation before I can prepare that. Please start a new chat and try again.";

/**
 * R19.4: each operation calls the existing deterministic handler with the router's structured arguments.
 * Returns null when the specialist declines (for example the email interpreter says it is not email), so the caller can ask a focused clarification.
 */
export async function dispatchDecision(decision: RouterDecision, ctx: DispatchContext): Promise<OrchestratorResult | null> {
  const { requestId, input, userId, context, conversationId } = ctx;
  const done = (answer: string, agents: string[], status: OrchestratorResult["status"] = "completed", choices?: string[] | null): OrchestratorResult => ({ requestId, answer: asText(answer, decision.operation), agents, confidence: decision.confidence, status, ...(choices?.length ? { choices } : {}) });

  // R19.6: unsure means ask, and nothing runs.
  if (decision.operation === "clarify" || (decision.clarification && decision.confidence < ROUTER_CONFIDENCE_THRESHOLD)) {
    return done(decision.clarification ?? "Could you say a bit more about what you'd like me to do?", [], "waiting_for_user", decision.choices);
  }

  switch (decision.operation) {
    case "email_draft_history":
      prepareAgentStage(["email"], "fast");
      return done(await answerDraftHistory(userId), ["email"]);
    case "dismiss":
      return done("Okay, we’ll leave it there.", []);
    case "general_answer": {
      // R29: "list everything you've suggested" is rendered from the saved records directly, never left to a model to scan and reproduce.
      if (decision.listSavedSearches) return done(renderSearchHistory(await loadRecentSearchStates(userId)), []);
      prepareAgentStage(["orchestrator"], "balanced");
      const memoryContext = buildMemoryContext(await listMemories(userId).catch(() => []));
      return done(await answerGeneral(input, context, "general", memoryContext), []);
    }
    case "email_import_continue":
      return done(await continueEmailFinanceImport(userId, conversationId), ["email", "finance"], "waiting_for_user");
    case "email": {
      const turn = await handleEmailConversationTurn(input, userId, conversationId, context);
      return turn ? done(turn.answer, turn.agents, turn.status, turn.choices) : null;
    }
    case "status_lookup":
      prepareAgentStage(["email"], "fast");
      return done(await answerStatusLookup(userId, { sender: decision.sender!, matter: decision.matter! }), ["email"]);
    case "finance_spending": {
      prepareAgentStage(["finance", "email"], "balanced");
      const freshness = await financeFreshness(userId, conversationId).catch(() => ({note: "Email sync is unavailable. This answer uses saved transactions only.", review: false}));
      if (freshness.review) return done(freshness.note, ["finance", "email"], "waiting_for_user");
      const answer = await answerFinance(input, userId, "read", context);
      return done([answer, freshness.note].filter(Boolean).join("\n\n"), ["finance"]);
    }
    case "finance_record":
      prepareAgentStage(["finance"], "fast");
      return done(await answerFinance(input, userId, "record", context), ["finance"]);
    case "bills_list":
      return done(await runBillsCommand({ type: "list" }, userId, { conversationId }), ["finance", "email"]);
    case "bills_paid":
      return done(await runBillsCommand({ type: "paid", merchant: decision.merchant!, paidOn: decision.paidOn }, userId), ["finance"]);
    case "bills_autopay":
      return done(await runBillsCommand({ type: "autopay", merchant: decision.merchant! }, userId), ["finance"]);
    case "learning_show": {
      const turn = await runLearningCommand({ type: "show" }, userId);
      return done(turn.answer, turn.agents, turn.status);
    }
    case "learning_forget": {
      const everything = !decision.term || /^(?:everything|all|it all)$/i.test(decision.term);
      if (!everything) {
        const turn = await runLearningCommand({ type: "forget", term: decision.term! }, userId);
        return done(turn.answer, turn.agents, turn.status);
      }
      // Forgetting everything needs a second yes. The model reads that yes; this only checks that Daylark had just asked for it.
      const asked = [...context].reverse().find((message) => message.role === "assistant")?.content.includes(FORGET_ALL_PROMPT);
      const turn = await runLearningCommand({ type: asked ? "confirm_forget_all" : "forget_all" }, userId);
      return done(turn.answer, turn.agents, turn.status);
    }
    case "learning_teach": {
      const learning = lessonToLearning(decision.lesson!);
      try {
        await saveLearning(userId, learning);
        return done(acknowledgeLearning(learning), [learning.kind === "autopay" || learning.kind === "merchant_category" || learning.kind === "merchant_alias" ? "finance" : learning.kind.startsWith("calendar") ? "calendar" : "email"]);
      } catch {
        return done("I couldn't save that just now, so I won't remember it next time. Try again in a moment.", [], "waiting_for_user");
      }
    }
    case "memory_show": {
      const [active, pending] = await Promise.all([listMemories(userId, ["active"]), listMemories(userId, ["pending"])]);
      return done(renderMemories(active, pending), []);
    }
    case "memory_forget": {
      if (!decision.term) return done("What should I forget?", [], "waiting_for_user");
      const matches = findMatchingMemories(await listMemories(userId, ["active", "pending"]), decision.term);
      if (!matches.length) return done(`I don't have anything remembered like "${decision.term}".`, []);
      await Promise.all(matches.map((memory) => forgetMemory(userId, memory.id)));
      return done(matches.length === 1 ? `Forgotten: "${matches[0].statement}".` : `Forgotten ${matches.length} things: ${matches.map((memory) => `"${memory.statement}"`).join(", ")}.`, []);
    }
    case "memory_remember": {
      // R.memory: an explicit "remember that..." bypasses the background writer and takes effect in this turn.
      const existing = await listMemories(userId, ["active", "pending"]).catch(() => []);
      const candidates = await extractMemoriesForUser(userId, decision.memoryStatement!, existing);
      if (!candidates.length) return done("I couldn't find anything specific to remember from that. Could you state it plainly, like \"I don't eat meat except fish and chicken\"?", [], "waiting_for_user");
      for (const candidate of candidates) {
        const id = await createMemory(userId, { type: candidate.type, category: candidate.category, strength: candidate.strength, statement: candidate.statement, status: "active", validUntil: candidate.validUntil, sourceExcerpt: decision.memoryStatement });
        if (candidate.supersedes) await supersedeMemory(userId, candidate.supersedes, id);
      }
      return done(candidates.length === 1 ? `Got it: "${candidates[0].statement}".` : `Got it. Remembered ${candidates.length} things: ${candidates.map((c) => `"${c.statement}"`).join(", ")}.`, []);
    }
    case "calendar_query":
      prepareAgentStage(["calendar"], "fast");
      return done(await answerCalendar(input, userId, context), ["calendar"]);
    case "calendar_create":
      prepareAgentStage(["general", "calendar"], "balanced");
      return done(await prepareCalendarCreate(input, userId, conversationId), ["calendar"], "waiting_for_user");
    case "calendar_delete":
      if (!conversationId) return done(NEEDS_CONVERSATION, ["calendar"], "waiting_for_user");
      prepareAgentStage(["calendar"], "fast");
      return done(await prepareCalendarDelete(userId, conversationId), ["calendar"], "waiting_for_user");
    case "calendar_attendees":
      if (!conversationId) return done(NEEDS_CONVERSATION, ["calendar"], "waiting_for_user");
      prepareAgentStage(["calendar"], "fast");
      return done(await prepareCalendarAttendeeUpdate(userId, conversationId, input), ["calendar"], "waiting_for_user");
    case "schedule_feasibility":
      prepareAgentStage(["general", "calendar"], "balanced");
      return done(await answerScheduleFeasibility(input, userId, context), ["general", "calendar"]);
    case "daily_view":
      prepareAgentStage(["calendar", "finance"], "fast");
      return done(await answerDailyView(userId), ["calendar", "finance"]);
    case "web_search": {
      // R19.5: structure only. A web_search decision always names its own search (the router's own rule); the raw message is never a
      // substitute; it has no location or context that made this a search in the first place, and searching it verbatim searches nothing
      // useful. Missing here means the router itself was unsure, so ask rather than guess.
      if (!decision.searchQuery?.trim()) return done("What place should I search? Say a city, neighborhood, or ZIP code.", [], "waiting_for_user");
      prepareAgentStage(["general"], "balanced");
      const searchMemory = buildMemoryContext(await listMemories(userId).catch(() => []));
      const remember = conversationId ? (state: Parameters<RememberSearch>[0]) => saveSearchState(userId, conversationId, state) : undefined;
      // Two or three genuinely separate subjects each get their own search and their own real answer, instead of one being shortchanged
      // by a single blended query ("protein bars and collagen" is two answers, not a compromise between them).
      if (decision.searchQueries && decision.searchQueries.length >= 2) {
        const answers = await Promise.all(decision.searchQueries.map((query, index) => answerPublicSearch(query, index === 0 ? remember : undefined, searchMemory)));
        return done(answers.join("\n\n---\n\n"), ["general"]);
      }
      // Remember what was shown, so "the second one" or "which is open now?" can be read next turn.
      return done(await answerPublicSearch(decision.searchQuery, remember, searchMemory), ["general"]);
    }
    case "multi": {
      const plan = planClauseInstructions(input, decision.agents);
      const multiMemory = decision.agents.includes("general") ? buildMemoryContext(await listMemories(userId).catch(() => [])) : "";
      const outcomes = await executeReadOnlyAgentPlan(plan.tasks, input, userId, context, decision.searchQuery, multiMemory);
      const completed = outcomes.filter((outcome) => outcome.ok).length;
      return done([composeMultiAgentAnswer(outcomes), ...plan.notes.map((note) => `> ${note}`)].join("\n\n"), decision.agents, completed === outcomes.length ? "completed" : "partially_completed");
    }
    case "email_write_declined":
      return done(EMAIL_READ_ONLY_NOTICE, ["email"]);
    case "email_draft": {
      // R25: a model writes the draft; the person approves it; only then is it saved in Gmail Drafts. Sending is not possible from here.
      if (!decision.draft) return done("Do you want me to write a new email or reply to one? Who is it for, and what should it say?", ["email"], "waiting_for_user");
      prepareAgentStage(["email"], "balanced");
      const owner = await ownerIdentity(userId);
      const reply = await prepareEmailDraft(decision.draft, { userId, conversationId, ownerName: owner.name, ownerEmail: owner.email, emailState: conversationId ? await loadEmailState(userId, conversationId) : null });
      return done(reply.answer, ["email"], reply.status, reply.choices);
    }
    case "approve":
    case "deny": {
      const outcome = await answerApproval(decision.operation === "approve", userId, conversationId);
      return outcome ? done(outcome.answer, outcome.agents, outcome.status) : done(decision.operation === "deny" ? "Okay, we’ll leave it there." : NOTHING_PENDING, []);
    }
    case "crisis":
      prepareAgentStage(["orchestrator"], "fast");
      return done(await answerGeneral(input, context, "crisis").catch(() => CRISIS_RESPONSE) || CRISIS_RESPONSE, []);
    case "unsafe":
      return done(UNSAFE_REFUSAL, []);
    case "casual":
      prepareAgentStage(["orchestrator"], "fast");
      return done(await answerCasual(input, context, "banter"), []);
    case "redirect": {
      // R23: the reply was written by the model as help, not a refusal. Code only makes sure one exists (the router already did).
      const plan = decision.redirect;
      return done(plan?.reply ?? "That's outside what I can help with, but I'm good with your email, calendar and spending. What would you like to do?", [], plan?.pivot?.ask ? "waiting_for_user" : "completed");
    }
    case "unsupported":
      prepareAgentStage(["orchestrator"], "fast");
      return done(await answerCasual(input, context, "boundary"), []);
  }
}
