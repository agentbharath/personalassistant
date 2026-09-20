import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { loadEmailState } from "@/lib/conversations/email-state";
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
}

type ContextMessage = { role: "user" | "assistant"; content: string };

/**
 * An explicit interface action: the Confirm or Cancel button on an approval card. It carries a fixed value, not free text, so it needs no
 * interpretation and works even when no model is available (R20.5).
 */
export type UiAction = "confirm" | "cancel";

/**
 * R20.5: what a message means is decided only by a model. When none can be used (no credit, the daily budget is used up, the provider is
 * down) Daylark says so and does nothing. It never falls back to patterns or rules. The emergency line is fixed text shown every time, so
 * it depends on no interpretation of the message.
 */
export const CANNOT_INTERPRET = "I can't interpret requests right now (the AI model isn't available, or today's model budget is used up), so I haven't done anything. Please try again in a bit. If you or someone else is in danger, call your local emergency number now (911 in the US), or call or text 988 if you're thinking about harming yourself. The Confirm and Cancel buttons on an approval still work.";

/** R22: when the model's specialist could not settle on a reading, ask instead of guessing. */
export const NOT_SURE = "I wasn't sure what you meant, so I didn't do anything. Could you say a bit more about what you'd like me to do?";

export async function runOrchestrator(input: string, userId: string, context: ContextMessage[] = [], conversationId?: string, suppliedRequestId?: string, uiAction?: UiAction): Promise<OrchestratorResult> {
  const requestId = suppliedRequestId ?? randomUUID();

  if (uiAction) {
    const outcome = await answerApproval(uiAction === "confirm", userId, conversationId);
    return outcome
      ? { requestId, answer: outcome.answer, agents: outcome.agents, confidence: 1, status: outcome.status }
      : { requestId, answer: NOTHING_PENDING, agents: [], confidence: 1, status: "completed" };
  }

  // R19, R20.5: one model call decides what the message means, including safety, approvals, dates and lessons, and the agents do the work
  // with its structured arguments. Nothing else judges the message.
  const routed = await routeForUser({
    userId,
    message: input,
    context,
    emailState: conversationId ? await loadEmailState(userId, conversationId) : null,
    today: Temporal.Now.zonedDateTimeISO(process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles").toPlainDate().toString(),
    pendingApproval: await hasPendingApproval(userId, conversationId),
  });

  if (!routed) {
    console.info("router", JSON.stringify({ requestId, source: "unavailable" }));
    return { requestId, answer: CANNOT_INTERPRET, agents: [], confidence: 1, status: "completed" };
  }

  console.info("router", JSON.stringify({ requestId, operation: routed.operation, confidence: routed.confidence, source: routed.source }));
  const result = await dispatchDecision(routed, { requestId, input, userId, context, conversationId });
  return result ?? { requestId, answer: NOT_SURE, agents: [], confidence: routed.confidence, status: "waiting_for_user" };
}
