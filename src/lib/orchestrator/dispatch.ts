import { answerCalendar } from "@/lib/agents/calendar";
import { prepareCalendarCreate } from "@/lib/agents/calendar-create";
import { answerFinance } from "@/lib/agents/finance";
import { answerPublicSearch } from "@/lib/agents/general";
import { runBillsCommand } from "@/lib/agents/bills-agent";
import { answerStatusLookup } from "@/lib/agents/status-lookup";
import { acknowledgeLearning } from "@/lib/learning/commands";
import type { Learning } from "@/lib/learning/learnings";
import { saveLearning } from "@/lib/learning/store";
import { answerCasual } from "@/lib/model/claude";
import { prepareAgentStage } from "@/lib/runtime/query-budget";
import { prepareCalendarAttendeeUpdate, prepareCalendarDelete, resolvePendingCalendarAttendeeUpdate, resolvePendingCalendarCreate, resolvePendingCalendarDelete } from "@/lib/workflows/calendar-create";
import { resolvePendingFinanceImport } from "@/lib/workflows/finance-import";
import { handleEmailConversationTurn } from "./email-turn";
import { answerScheduleFeasibility } from "./feasibility";
import { answerDailyView } from "@/lib/today/answer";
import { runLearningCommand } from "./learning-turn";
import { composeMultiAgentAnswer, executeReadOnlyAgentPlan, planClauseInstructions } from "./multi-agent";
import { ROUTER_CONFIDENCE_THRESHOLD, type ContextMessage, type Lesson, type RouterDecision } from "./router";
import { CRISIS_RESPONSE } from "./scope";
import { UNSAFE_REFUSAL } from "./safety";
import { EMAIL_READ_ONLY_NOTICE } from "./routing";
import type { OrchestratorResult } from "./run";

export type DispatchContext = { requestId: string; input: string; userId: string; context: ContextMessage[]; conversationId?: string };

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
  ];
  for (const [agent, resolve] of resolvers) {
    const outcome = await resolve();
    if (outcome) return { ...outcome, agents: [agent] };
  }
  return null;
}
const DRAFTS_NOT_AVAILABLE = "I can't save email drafts yet, because Daylark's Gmail access is read-only for now. I can summarise the email so you can write the reply yourself.";
const NEEDS_CONVERSATION = "I need a saved conversation before I can prepare that. Please start a new chat and try again.";

/**
 * R19.4: each operation calls the existing deterministic handler with the router's structured arguments.
 * Returns null when the specialist declines (for example the email interpreter says it is not email), so the rule chain can decide.
 */
export async function dispatchDecision(decision: RouterDecision, ctx: DispatchContext): Promise<OrchestratorResult | null> {
  const { requestId, input, userId, context, conversationId } = ctx;
  const done = (answer: string, agents: string[], status: OrchestratorResult["status"] = "completed", choices?: string[] | null): OrchestratorResult => ({ requestId, answer, agents, confidence: decision.confidence, status, ...(choices?.length ? { choices } : {}) });

  // R19.6: unsure means ask, and nothing runs.
  if (decision.operation === "clarify" || (decision.clarification && decision.confidence < ROUTER_CONFIDENCE_THRESHOLD)) {
    return done(decision.clarification ?? "Could you say a bit more about what you'd like me to do?", [], "waiting_for_user", decision.choices);
  }

  switch (decision.operation) {
    case "email": {
      const turn = await handleEmailConversationTurn(input, userId, conversationId, context);
      return turn ? done(turn.answer, turn.agents, turn.status) : null;
    }
    case "status_lookup":
      prepareAgentStage(["email"], "fast");
      return done(await answerStatusLookup(userId, { sender: decision.sender!, matter: decision.matter! }), ["email"]);
    case "finance_spending":
    case "finance_record":
      prepareAgentStage(["finance"], "fast");
      return done(await answerFinance(input, userId), ["finance"]);
    case "bills_list":
      return done(await runBillsCommand({ type: "list" }, userId), ["finance"]);
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
    case "web_search":
      prepareAgentStage(["general"], "balanced");
      // R20.5: the router wrote the search (typos fixed, the saved home place added for "near me"); the raw message is the fallback.
      return done(await answerPublicSearch(decision.searchQuery || input), ["general"]);
    case "multi": {
      const plan = planClauseInstructions(input, decision.agents);
      const outcomes = await executeReadOnlyAgentPlan(plan.tasks, input, userId, context);
      const completed = outcomes.filter((outcome) => outcome.ok).length;
      return done([composeMultiAgentAnswer(outcomes), ...plan.notes.map((note) => `> ${note}`)].join("\n\n"), decision.agents, completed === outcomes.length ? "completed" : "partially_completed");
    }
    case "email_write_declined":
      return done(EMAIL_READ_ONLY_NOTICE, ["email"]);
    case "email_draft":
      // R25: saving drafts is decided and its safe foundation is built, but it stays off (and unbuilt in the chat) until it is released with
      // the matching Privacy Policy and Terms. Until then a drafting request gets an honest answer, never a made-up draft.
      return done(DRAFTS_NOT_AVAILABLE, ["email"]);
    case "approve":
    case "deny": {
      const outcome = await answerApproval(decision.operation === "approve", userId, conversationId);
      return outcome ? done(outcome.answer, outcome.agents, outcome.status) : done(NOTHING_PENDING, []);
    }
    case "crisis":
      return done(CRISIS_RESPONSE, []);
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
