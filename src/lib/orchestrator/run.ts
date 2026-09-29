import { recallConversation } from "@/lib/conversations/history";
import { getRequestContext, extendRequestBudget } from "@/lib/runtime/request-context";
import { continueEmailFinanceImport } from "@/lib/agents/email-finance-import";
import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { loadEmailState } from "@/lib/conversations/email-state";
import { loadSearchState, loadRecentSearchStates, searchRecallContext } from "@/lib/conversations/search-state";
import { loadRecentResearchStates, researchRecallContext } from "@/lib/conversations/research-state";
import { hasPendingApproval } from "@/lib/workflows/pending";
import { NOTHING_PENDING, answerApproval, dispatchDecision } from "./dispatch";
import { routeForUser } from "./router-runtime";

export interface OrchestratorResult {
  requestId: string;
  answer: string;
  agents: string[];
  confidence: number;
  status: "completed" | "waiting_for_user" | "partially_completed";
  /** When the answer is a question with a few possible answers, they are offered as tap-to-answer choices (free text is still accepted). */
  choices?: string[];
  /** The router's own operation, when one was actually decided (undefined for a UI action or when the router itself was unavailable) — so
   * the caller can tell an explicit memory_remember/memory_forget turn apart from an ordinary one (R.memory, found live: the background
   * extractor was independently re-reading the same message an explicit "remember that..." had already handled deliberately, sometimes
   * inferring an extra, unwanted fact from it — a duplicate write the person never asked for). */
  operation?: string;
}

type ContextMessage = { role: "user" | "assistant"; content: string; choices?: string[] };

/**
 * An explicit interface action: the Confirm or Cancel button on an approval card. It carries a fixed value, not free text, so it needs no
 * interpretation and works even when no model is available (R20.5).
 */
export type UiAction = "confirm" | "cancel" | "continue_scan";

/**
 * R20.5: what a message means is decided only by a model. When none can be used (no credit, the daily budget is used up, the provider is
 * down) Daylark says so and does nothing. It never falls back to patterns or rules. Service failures never infer a crisis or display unrelated emergency resources.
 */
export const CANNOT_INTERPRET = "I couldn’t process that request because the AI service is unavailable or a usage limit has been reached. Please try again later. Your saved work is unchanged.";

// The Confirm/Cancel/Continue scan buttons only exist when an import is actually mid-review; mentioning them otherwise (found live, R37 --
// a weather question got told its "scan buttons still work") is just confusing. Same underlying failure, only the trailing sentence differs.
const CANNOT_INTERPRET_WITH_PENDING_APPROVAL = `${CANNOT_INTERPRET} Confirm, Cancel, and Continue scan buttons still work, though further extraction may need the AI service.`;

/** R22: when the model's specialist could not settle on a reading, ask instead of guessing. */
export const NOT_SURE = "I wasn't sure what you meant, so I didn't do anything. Could you say a bit more about what you'd like me to do?";

export async function runOrchestrator(input: string, userId: string, context: ContextMessage[] = [], conversationId?: string, suppliedRequestId?: string, uiAction?: UiAction): Promise<OrchestratorResult> {
  const requestId = suppliedRequestId ?? randomUUID();

  if (uiAction === "continue_scan") return { requestId, answer: await continueEmailFinanceImport(userId, conversationId), agents: ["email", "finance"], confidence: 1, status: "waiting_for_user" };

  if (uiAction) {
    const outcome = await answerApproval(uiAction === "confirm", userId, conversationId);
    return outcome
      ? { requestId, answer: outcome.answer, agents: outcome.agents, confidence: 1, status: outcome.status }
      : { requestId, answer: NOTHING_PENDING, agents: [], confidence: 1, status: "completed" };
  }

  // Cross-conversation search recall matters most early in a conversation ("what did you find me yesterday"). Once a conversation has
  // built up its own real context (a multi-turn trip being planned, say), a pile of unrelated saved restaurant searches only competes with
  // it for the model's attention and can dilute a plain "the trip we're already discussing" reference. R29's own "list everything" answer
  // does not depend on this block being present: it re-reads the saved records directly, so nothing is lost by skipping this when it
  // would only be noise. Research comparisons (R47) get the same treatment -- found live: a brand new conversation asking "which air
  // purifier did you recommend" had nothing to recall from at all, since research mode had no persistence before this.
  const recalled = context.length <= 4
    ? [searchRecallContext(await loadRecentSearchStates(userId)), researchRecallContext(await loadRecentResearchStates(userId))].filter(Boolean).join("\n")
    : "";
  if (recalled) context = [{ role: "assistant", content: `Earlier conversation summary:\n${context.filter(turn => turn.content.startsWith("Earlier conversation summary")).map(turn => turn.content).join("\n")}\n${recalled}` }, ...context.filter(turn => !turn.content.startsWith("Earlier conversation summary"))];

  // R19, R20.5: one model call decides what the message means, including safety, approvals, dates and lessons, and the agents do the work
  // with its structured arguments. Nothing else judges the message.
  const routingInput = {
    userId,
    message: input,
    context,
    emailState: conversationId ? await loadEmailState(userId, conversationId) : null,
    lastSearch: conversationId ? await loadSearchState(userId, conversationId) : null,
    today: Temporal.Now.zonedDateTimeISO(process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles").toPlainDate().toString(),
    pendingApproval: await hasPendingApproval(userId, conversationId),
  };
  let routed = await routeForUser(routingInput);
  if (routed?.historyQuery && conversationId) {
    extendRequestBudget(60_000, 0.15);
    const history = await recallConversation(userId, conversationId, routed.historyQuery, context);
    const runtime = getRequestContext();
    if (runtime) runtime.recalledReferences = history.references;
    const prior = context.filter(turn => turn.content.startsWith("Earlier conversation summary")).map(turn => turn.content).join("\n");
    context = [{ role: "assistant", content: `Earlier conversation summary:\n${history.text}\n${prior.slice(0, 3000)}` }, ...context.filter(turn => !turn.content.startsWith("Earlier conversation summary"))];
    routed = await routeForUser({ ...routingInput, context });
  }

  if (!routed) {
    console.info("router", JSON.stringify({ requestId, source: "unavailable" }));
    return { requestId, answer: routingInput.pendingApproval ? CANNOT_INTERPRET_WITH_PENDING_APPROVAL : CANNOT_INTERPRET, agents: [], confidence: 1, status: "completed" };
  }

  console.info("router", JSON.stringify({ requestId, operation: routed.operation, confidence: routed.confidence, source: routed.source }));
  if (routed.continuityBlocked) return { requestId, answer: routed.clarification!, agents: [], confidence: 0, status: "partially_completed", operation: routed.operation };
  const result = await dispatchDecision(routed, { requestId, input: routed.resolvedInput || input, userId, context, conversationId });
  return { ...(result ?? { requestId, answer: NOT_SURE, agents: [], confidence: routed.confidence, status: "waiting_for_user" as const }), operation: routed.operation };
}
