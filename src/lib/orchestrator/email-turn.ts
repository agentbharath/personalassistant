import { answerEmail, invoiceFactsForMessage, showEmailMessage } from "@/lib/agents/email";
import { parseOrdinalReference, type OrdinalReference } from "@/lib/agents/email-ordinal";
import { prepareEmailFinanceImport, prepareImportForMessage } from "@/lib/agents/email-finance-import";
import { CONFIDENCE_THRESHOLD } from "@/lib/agents/email-interpreter";
import { interpretEmailForUser } from "@/lib/agents/email-interpreter-runtime";
import { EMAIL_NOUNS, parseEmailRequest, renderEmailRequest, type EmailRequest } from "@/lib/agents/email-request";
import { isEmailFinanceImport, isEmailSearch } from "./routing";
import { loadEmailState, type EmailState } from "@/lib/conversations/email-state";
import { extractCorrectedRequest } from "@/lib/agents/email-followup";
import { acknowledgeLearning } from "@/lib/learning/commands";
import { DEFAULT_WINDOW_DAYS, NO_LEARNINGS, applyLearnedAction, detectCorrection, learnFromReinterpretation, withLearning, type Learnings } from "@/lib/learning/learnings";
import { loadLearnings, saveLearning } from "@/lib/learning/store";
import { prepareAgentStage } from "@/lib/runtime/query-budget";

type ContextMessage = { role: "user" | "assistant"; content: string };
export type EmailTurn = { answer: string; agents: Array<"email" | "finance">; status: "completed" | "waiting_for_user"; choices?: string[] };

/** "1", "2", ... for a short list of results, so the person can tap instead of typing. Longer lists are not offered as buttons. */
const numberChoices = (count: number) => (count >= 2 && count <= 8 ? Array.from({ length: count }, (_, index) => String(index + 1)) : undefined);

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
const NO_LIST = "I don't have a list in front of me to point at. Want me to search again?";

function lastAssistantWasEmail(context: ContextMessage[]) {
  const last = [...context].reverse().find((message) => message.role === "assistant")?.content ?? "";
  return /### Matching email|_Searched:|### (?:Invoice|Email) details/.test(last);
}

/** R13: "import the second one", "how much was #3", "show me the latest one". */
async function handleOrdinal(ref: OrdinalReference, state: EmailState, userId: string, conversationId: string | undefined): Promise<EmailTurn> {
  if ("ask" in ref) return { answer: `Which one? Say a number from 1 to ${state.results.length}.`, agents: ["email"], status: "waiting_for_user", choices: numberChoices(state.results.length) };
  if ("outOfRange" in ref) return { answer: `I only showed ${ref.outOfRange} result${ref.outOfRange === 1 ? "" : "s"}. Pick a number between 1 and ${ref.outOfRange}.`, agents: ["email"], status: "waiting_for_user", choices: numberChoices(ref.outOfRange) };
  const target = state.results[ref.index];
  if (ref.action === "import") {
    prepareAgentStage(["email", "finance"], "balanced");
    return { answer: await prepareImportForMessage(userId, conversationId, target.id), agents: ["email", "finance"], status: "waiting_for_user" };
  }
  prepareAgentStage(["email"], "fast");
  const answer = ref.action === "facts" ? (await invoiceFactsForMessage(userId, target.id, TIME_ZONE)).text : await showEmailMessage(userId, target.id);
  return { answer, agents: ["email"], status: "completed" };
}

/** Cheap gate: is this worth an interpreter call when nothing is saved? */
function looksLikeEmail(input: string) {
  if (EMAIL_NOUNS.test(input) || isEmailSearch(input) || isEmailFinanceImport(input)) return true;
  const request = parseEmailRequest(input);
  return request.topic !== "general" || request.sender !== null || request.action !== "list" || request.unread;
}

/** Last email request in the messages, used only when there is no saved state (R5.7). */
function lastRequestFromMessages(context: ContextMessage[]): EmailRequest | null {
  for (const message of [...context].reverse()) {
    if (message.role !== "user") continue;
    const request = parseEmailRequest(message.content);
    if (request.sender || request.topic !== "general") return request;
  }
  return null;
}

async function run(requested: EmailRequest, userId: string, conversationId: string | undefined, learnings: Learnings, message = ""): Promise<EmailTurn> {
  // R11.8: a learned default (receipts mean amounts) applies to a plain request, unless the message asks for the emails themselves.
  const { request, applied } = applyLearnedAction(requested, message, learnings);
  const text = renderEmailRequest(request);
  if (request.action === "import" || request.action === "import_all") {
    prepareAgentStage(["email", "finance"], "balanced");
    return { answer: await prepareEmailFinanceImport(text, userId, conversationId), agents: ["email", "finance"], status: "waiting_for_user" };
  }
  prepareAgentStage(["email"], "fast");
  const answer = await answerEmail(text, userId, { conversationId, learnings });
  return { answer: applied ? `${answer}\n\n_Showing amounts because you asked for that. Say “just list the emails” for a plain list._` : answer, agents: ["email"], status: "completed" };
}

/**
 * Handles the conversational side of email: explicit corrections (R11.4) and follow-ups (R5.7).
 * Returns null for anything else, so standalone requests use the normal routes.
 */
export async function handleEmailConversationTurn(input: string, userId: string, conversationId: string | undefined, context: ContextMessage[], options: { force?: boolean } = {}): Promise<EmailTurn | null> {
  const state = conversationId ? await loadEmailState(userId, conversationId) : null;
  const last = state?.request ?? lastRequestFromMessages(context);

  // R13: ordinal references first. They only make sense against a saved, numbered list.
  if (state?.results.length) {
    const ref = parseOrdinalReference(input, state.results);
    if (ref) return handleOrdinal(ref, state, userId, conversationId);
  } else if (parseOrdinalReference(input, []) && lastAssistantWasEmail(context)) {
    return { answer: NO_LIST, agents: ["email"], status: "completed" };
  }

  const correction = detectCorrection(input, last);
  if (correction) {
    let saved = true;
    await saveLearning(userId, correction).catch(() => { saved = false; });
    const ack = saved ? acknowledgeLearning(correction) : "I'll use that for now, but I couldn't save it for next time.";
    const learnings = withLearning(await loadLearnings(userId).catch(() => NO_LEARNINGS), correction);
    if (!last) return { answer: ack, agents: ["email"], status: "completed" };
    const base = correction.kind === "sender_alias" ? { ...last, sender: correction.canonical } : last;
    const rerun = await run(base, userId, conversationId, learnings, input);
    return { ...rerun, answer: `${ack}\n\n${rerun.answer}` };
  }

  // R16.1: one interpreter for everything that looks like email, and for anything said while a fresh email search is saved.
  if (!options.force && !state && !looksLikeEmail(input)) return null;
  const interpretation = await interpretEmailForUser({ userId, message: input, state, context });
  if (interpretation.domain !== "email") return null;
  // R16.5, R12: unsure means ask, naming the likeliest readings, and search nothing.
  if (interpretation.clarification && interpretation.confidence < CONFIDENCE_THRESHOLD) {
    return { answer: interpretation.clarification, agents: ["email"], status: "waiting_for_user" };
  }
  let learnings = await loadLearnings(userId).catch(() => NO_LEARNINGS);
  // R11.8, R11.6: only an explicit correction ("I meant the amount receipts") teaches Daylark what a request means.
  const taught = learnFromReinterpretation(state?.request ?? null, interpretation.request, extractCorrectedRequest(input) !== null, learnings);
  let acknowledgement = "";
  if (taught) {
    let saved = true;
    await saveLearning(userId, taught).catch(() => { saved = false; });
    learnings = withLearning(learnings, taught);
    acknowledgement = saved ? `${acknowledgeLearning(taught)}\n\n` : "";
  }
  const turn = await run(interpretation.request, userId, conversationId, learnings, input);
  return acknowledgement ? { ...turn, answer: `${acknowledgement}${turn.answer}` } : turn;
}

export { DEFAULT_WINDOW_DAYS };
