import { GoogleGmailAccessError, gmailFailureMessage } from "@/lib/tools/email/gmail-transport";
import { getRequestContext } from "@/lib/runtime/request-context";
import { answerEmail, invoiceFactsForMessage, showEmailMessage } from "@/lib/agents/email";
import { prepareEmailFinanceImport, prepareImportForMessage } from "@/lib/agents/email-finance-import";
import { CONFIDENCE_THRESHOLD } from "@/lib/agents/email-interpreter";
import { interpretEmailForUser } from "@/lib/agents/email-interpreter-runtime";
import { renderEmailRequest, type EmailRequest } from "@/lib/agents/email-request";
import { loadEmailState, type EmailState } from "@/lib/conversations/email-state";
import { acknowledgeLearning } from "@/lib/learning/commands";
import { DEFAULT_WINDOW_DAYS, NO_LEARNINGS, applyLearnedAction, learnFromReinterpretation, withLearning, type Learnings } from "@/lib/learning/learnings";
import { loadLearnings, saveLearning } from "@/lib/learning/store";
import { prepareAgentStage } from "@/lib/runtime/query-budget";

type ContextMessage = { role: "user" | "assistant"; content: string; choices?: string[] };
export type EmailTurn = { answer: string; agents: Array<"email" | "finance">; status: "completed" | "waiting_for_user"; choices?: string[] };

/** "1", "2", ... for a short list of results, so the person can tap instead of typing. Longer lists are not offered as buttons. */
const numberChoices = (count: number) => (count >= 2 && count <= 8 ? Array.from({ length: count }, (_, index) => String(index + 1)) : undefined);

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

/** R13: "import the second one", "how much was #3", "show me the latest one". */
type OrdinalReference = { action: "import" | "facts" | "show"; index: number };

async function handleOrdinal(ref: OrdinalReference, state: EmailState, userId: string, conversationId: string | undefined): Promise<EmailTurn> {
  const target = state.results[ref.index];
  try {
    if (ref.action === "import") {
      prepareAgentStage(["email", "finance"], "balanced");
      return { answer: await prepareImportForMessage(userId, conversationId, target.id), agents: ["email", "finance"], status: "waiting_for_user" };
    }
    prepareAgentStage(["email"], "fast");
    const answer = ref.action === "facts" ? (await invoiceFactsForMessage(userId, target.id, TIME_ZONE)).text : await showEmailMessage(userId, target.id);
    return { answer, agents: ["email"], status: "completed" };
  } catch (error) {
    if (!(error instanceof GoogleGmailAccessError)) throw error;
    const answer = error.reason === "not_found"
      ? "I found that item in our saved conversation, but the email is no longer available in Gmail."
      : `I found the saved reference, but couldn’t read the email: ${gmailFailureMessage(error)}.`;
    return { answer, agents: ["email"], status: "completed" };
  }
}

async function run(requested: EmailRequest, userId: string, conversationId: string | undefined, learnings: Learnings, plainList = false): Promise<EmailTurn> {
  // R11.8: a learned default (receipts mean amounts) applies to a plain request, unless the message asks for the emails themselves.
  const { request, applied } = applyLearnedAction(requested, plainList, learnings);
  const text = renderEmailRequest(request);
  if (request.action === "import" || request.action === "import_all") {
    prepareAgentStage(["email", "finance"], "balanced");
    return { answer: await prepareEmailFinanceImport(text, userId, conversationId, request), agents: ["email", "finance"], status: "waiting_for_user" };
  }
  prepareAgentStage(["email"], "fast");
  const answer = await answerEmail(text, userId, { conversationId, learnings, request });
  return { answer: applied ? `${answer}\n\n_Showing amounts because you asked for that. Say “just list the emails” for a plain list._` : answer, agents: ["email"], status: "completed" };
}

/** R20.5: no model, no guess. Nothing was searched or changed. */
export const EMAIL_UNAVAILABLE = "I can't read email requests right now (the AI model isn't available), so I haven't searched anything. Please try again in a bit.";

/**
 * The email turn: one model reading (R16.1) says what was asked, including pointing at a numbered result (R13) and whether it corrects the
 * earlier search (R11.4). Code only acts on that reading. Returns null when the model says the message is not about email.
 */
export async function handleEmailConversationTurn(input: string, userId: string, conversationId: string | undefined, context: ContextMessage[]): Promise<EmailTurn | null> {
  const state = conversationId ? await loadEmailState(userId, conversationId) : null;
  const archives = (getRequestContext()?.recalledReferences ?? []).flatMap(ref => ref.kind === "email_results" ? [{ id: ref.id, state: ref.state }] : []);
  const interpretation = await interpretEmailForUser({ userId, message: input, state, archives, context });
  if (interpretation.source === "unavailable") return { answer: EMAIL_UNAVAILABLE, agents: ["email"], status: "completed" };
  if (interpretation.continuityBlocked) return { answer: interpretation.clarification!, agents: ["email"], status: "completed" };
  if (interpretation.domain !== "email") return null;
  // R16.5, R12: unsure means ask, naming the likeliest readings, and search nothing.
  if (interpretation.clarification && interpretation.confidence < CONFIDENCE_THRESHOLD) {
    return { answer: interpretation.clarification, agents: ["email"], status: "waiting_for_user", choices: state?.results.length ? numberChoices(state.results.length) : undefined };
  }
  const selectedState = interpretation.pick?.referenceId ? archives.find(archive => archive.id === interpretation.pick?.referenceId)?.state : state;
  if (interpretation.pick && selectedState?.results[interpretation.pick.index]) return handleOrdinal({ action: interpretation.pick.action, index: interpretation.pick.index }, selectedState, userId, conversationId);
  if (interpretation.pick) return { answer: "I couldn’t locate that item in the earlier result list. Which list did you mean?", agents: ["email"], status: "waiting_for_user" };

  let learnings = await loadLearnings(userId).catch(() => NO_LEARNINGS);
  // R11.8, R11.6: only an explicit correction ("I meant the amount receipts") teaches Daylark what a request means.
  const taught = learnFromReinterpretation(state?.request ?? null, interpretation.request, interpretation.correction, learnings);
  let acknowledgement = "";
  if (taught) {
    let saved = true;
    await saveLearning(userId, taught).catch(() => { saved = false; });
    learnings = withLearning(learnings, taught);
    acknowledgement = saved ? `${acknowledgeLearning(taught)}\n\n` : "";
  }
  const turn = await run(interpretation.request, userId, conversationId, learnings, interpretation.plainList);
  return acknowledgement ? { ...turn, answer: `${acknowledgement}${turn.answer}` } : turn;
}

export { DEFAULT_WINDOW_DAYS };
