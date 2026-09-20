import { createHash, randomUUID } from "node:crypto";
import { classifyDeterministically } from "./intent";
import { answerCasual, classifyWithClaude } from "@/lib/model/claude";
import { answerCalendar } from "@/lib/agents/calendar";
import { answerScheduleFeasibility } from "./feasibility";
import { answerPublicSearch } from "@/lib/agents/general";
import { answerFinance } from "@/lib/agents/finance";
import { answerEmail } from "@/lib/agents/email";
import { handleEmailConversationTurn } from "./email-turn";
import { loadEmailState } from "@/lib/conversations/email-state";
import { hasPendingApproval } from "@/lib/workflows/pending";
import { Temporal } from "@js-temporal/polyfill";
import { dispatchDecision } from "./dispatch";
import { routeForUser } from "./router-runtime";
import { handleBillsTurn } from "./bills-turn";
import { handleStatusLookup } from "./status-turn";
import { handleLearningTurn } from "./learning-turn";
import { fixDomainTypos } from "@/lib/agents/email-query";
import { prepareEmailFinanceImport } from "@/lib/agents/email-finance-import";
import { resolvePendingFinanceImport } from "@/lib/workflows/finance-import";
import { prepareCalendarCreate } from "@/lib/agents/calendar-create";
import { prepareCalendarAttendeeUpdate, prepareCalendarDelete, resolvePendingCalendarAttendeeUpdate, resolvePendingCalendarCreate, resolvePendingCalendarDelete } from "@/lib/workflows/calendar-create";
import { EMAIL_READ_ONLY_NOTICE, deterministicReadOnlyAgents, isCalendarAttendeeUpdate, isCalendarCreate, isCalendarDelete, isEmailFinanceImport, isEmailMutation, isEmailSearch, isPublicSearchQuery, isScheduleFeasibility } from "./routing";
import { prepareAgentStage } from "@/lib/runtime/query-budget";
import { composeMultiAgentAnswer, executeReadOnlyAgentPlan, planClauseInstructions } from "./multi-agent";
import { dangerousRequestRefusal } from "./safety";
import { acceptedCapabilityBridge, capabilityBridge, classifyCasualMessage, crisisResponse, outOfScopeResponse, pendingWebBridgeLocation } from "./scope";

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

export async function runOrchestrator(input: string, userId: string, context: ContextMessage[] = [], conversationId?: string, suppliedRequestId?: string): Promise<OrchestratorResult> {
  const requestId = suppliedRequestId ?? randomUUID();
  const userRef = createHash("sha256").update(userId).digest("hex").slice(0, 32);
  // R19: model first. One router call decides what the message means, including safety, approvals, dates and lessons, and the agents
  // do the work with its structured arguments. Rules never judge the message. They run below only when the router cannot be used
  // (model error or budget), and the source is logged (R19.8).
  const routed = await routeForUser({
    userId,
    message: input,
    context,
    emailState: conversationId ? await loadEmailState(userId, conversationId) : null,
    today: Temporal.Now.zonedDateTimeISO(process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles").toPlainDate().toString(),
    pendingApproval: await hasPendingApproval(userId, conversationId),
  });
  if (routed) {
    console.info("router", JSON.stringify({ requestId, operation: routed.operation, confidence: routed.confidence, source: routed.source }));
    const result = await dispatchDecision(routed, { requestId, input, userId, context, conversationId });
    if (result) return result;
  }
  console.info("router", JSON.stringify({ requestId, source: "rules" }));
  const crisis = crisisResponse(input);
  if (crisis) return { requestId, answer: crisis, agents: [], confidence: 1, status: "completed" };
  const safetyRefusal = dangerousRequestRefusal(input, context);
  if (safetyRefusal) {
    return { requestId, answer: safetyRefusal, agents: [], confidence: 1, status: "completed" };
  }
  const acceptedBridge = acceptedCapabilityBridge(input, context);
  const bridgeSearchQuery = pendingWebBridgeLocation(input, context);
  if (bridgeSearchQuery) {
    prepareAgentStage(["general"], "balanced");
    return { requestId, answer: await answerPublicSearch(bridgeSearchQuery), agents: ["general"], confidence: 1, status: "completed" };
  }
  if (acceptedBridge?.capability === "web") {
    return { requestId, answer: "What city or ZIP code should I search around?", agents: ["general"], confidence: 1, status: "waiting_for_user" };
  }
  if (acceptedBridge?.capability === "finance") {
    prepareAgentStage(["finance"], "fast");
    return { requestId, answer: await answerFinance("Summarize my recent spending and recurring bills.", userId), agents: ["finance"], confidence: 1, status: "completed" };
  }
  if (acceptedBridge?.capability === "calendar") {
    prepareAgentStage(["calendar"], "fast");
    return { requestId, answer: await answerCalendar("Show my upcoming schedule and identify busy periods.", userId), agents: ["calendar"], confidence: 1, status: "completed" };
  }
  if (acceptedBridge?.capability === "email") {
    prepareAgentStage(["email"], "fast");
    return { requestId, answer: await answerEmail("Find recent messages that may be awaiting my attention.", userId), agents: ["email"], confidence: 1, status: "completed" };
  }
  const bridge = capabilityBridge(input);
  if (bridge) return { requestId, answer: bridge.answer, agents: [bridge.capability === "web" ? "general" : bridge.capability], confidence: 1, status: "waiting_for_user" };
  const casualKind = classifyCasualMessage(input);
  if (casualKind) {
    prepareAgentStage(["orchestrator"], "fast");
    return { requestId, answer: await answerCasual(input, context, casualKind), agents: [], confidence: 1, status: "completed" };
  }
  const scopeRefusal = outOfScopeResponse(input, context);
  if (scopeRefusal) {
    prepareAgentStage(["orchestrator"], "fast");
    return { requestId, answer: await answerCasual(input, context, "boundary"), agents: [], confidence: 1, status: "completed" };
  }
  if (conversationId) {
    const pendingCalendarDelete = await resolvePendingCalendarDelete(userId, conversationId, input);
    if (pendingCalendarDelete) return { requestId, answer: pendingCalendarDelete.answer, agents: ["calendar"], confidence: 1, status: pendingCalendarDelete.status };
    const pendingCalendarUpdate = await resolvePendingCalendarAttendeeUpdate(userId, conversationId, input);
    if (pendingCalendarUpdate) return { requestId, answer: pendingCalendarUpdate.answer, agents: ["calendar"], confidence: 1, status: pendingCalendarUpdate.status };
    const pendingCalendar = await resolvePendingCalendarCreate(userId, conversationId, input);
    if (pendingCalendar) return { requestId, answer: pendingCalendar.answer, agents: ["calendar"], confidence: 1, status: pendingCalendar.status };
    const pending = await resolvePendingFinanceImport(userId, conversationId, input);
    if (pending) return { requestId, answer: pending.answer, agents: ["finance"], confidence: 1, status: pending.status };
  }
  // R14, R15: things the user teaches Daylark, and asking what it has learned. Runs on the user's own words, before typo repair.
  const learningTurn = await handleLearningTurn(input, userId);
  if (learningTurn) return { requestId, answer: learningTurn.answer, agents: learningTurn.agents, confidence: 1, status: learningTurn.status };
  // R17: bills. "I paid the PG&E bill", "PG&E is on autopay", "what bills are outstanding".
  const billsTurn = await handleBillsTurn(input, userId);
  if (billsTurn) return { requestId, answer: billsTurn.answer, agents: billsTurn.agents, confidence: 1, status: billsTurn.status };
  // R18: "what's the status of my chase dispute". A rule-based email lookup, so it does not depend on the model budget.
  const statusTurn = await handleStatusLookup(input, userId);
  if (statusTurn) return { requestId, answer: statusTurn.answer, agents: statusTurn.agents, confidence: 1, status: statusTurn.status };
  input = fixDomainTypos(input);
  if (isGreetingOnly(input)) {
    prepareAgentStage(["orchestrator"], "fast");
    return { requestId, answer: await answerCasual(input, context, "greeting"), agents: [], confidence: 1, status: "completed" };
  }
  if (isEmailMutation(input)) {
    return { requestId, answer: EMAIL_READ_ONLY_NOTICE, agents: ["email"], confidence: 0.95, status: "completed" };
  }
  if (conversationId && isCalendarDelete(input)) {
    prepareAgentStage(["calendar"], "fast");
    const deletion = await prepareCalendarDelete(userId, conversationId);
    const emailNote = /\b(?:email|mail|message|notify|tell)\b/i.test(input) ? "\n\n> I can’t send a separate email; deleting an event notifies its guests." : "";
    return { requestId, answer: deletion + emailNote, agents: ["calendar"], confidence: 0.99, status: "waiting_for_user" };
  }
  if (conversationId && isCalendarAttendeeUpdate(input)) {
    prepareAgentStage(["calendar"], "fast");
    return { requestId, answer: await prepareCalendarAttendeeUpdate(userId, conversationId, input), agents: ["calendar"], confidence: 0.99, status: "waiting_for_user" };
  }
  if (isCalendarCreate(input)) {
    prepareAgentStage(["general", "calendar"], "balanced");
    return { requestId, answer: await prepareCalendarCreate(input, userId, conversationId), agents: /\b(find|look up|concert|show|game|public event)\b/i.test(input) ? ["general", "calendar"] : ["calendar"], confidence: 0.94, status: "waiting_for_user" };
  }
  const emailTurn = await handleEmailConversationTurn(input, userId, conversationId, context);
  if (emailTurn) return { requestId, answer: emailTurn.answer, agents: emailTurn.agents, confidence: 0.9, status: emailTurn.status, choices: emailTurn.choices };
  if (isEmailFinanceImport(input)) {
    prepareAgentStage(["email", "finance"], "balanced");
    return { requestId, answer: await prepareEmailFinanceImport(input, userId, conversationId), agents: ["email", "finance"], confidence: 0.96, status: "waiting_for_user" };
  }
  const deterministicAgents = deterministicReadOnlyAgents(input);
  if (deterministicAgents.length > 1) {
    prepareAgentStage(deterministicAgents, "fast");
    const plan = planClauseInstructions(input, deterministicAgents);
    const outcomes = await executeReadOnlyAgentPlan(plan.tasks, input, userId, context);
    const completedCount = outcomes.filter((outcome) => outcome.ok).length;
    return { requestId, answer: [composeMultiAgentAnswer(outcomes), ...plan.notes.map((note) => `> ${note}`)].join("\n\n"), agents: deterministicAgents, confidence: 0.94, status: completedCount === outcomes.length ? "completed" : "partially_completed" };
  }
  if (isScheduleFeasibility(input)) {
    prepareAgentStage(["general", "calendar"], "balanced");
    return { requestId, answer: await answerScheduleFeasibility(input, userId), agents: ["general", "calendar"], confidence: 0.94, status: "completed" };
  }
  if (isEmailSearch(input)) {
    prepareAgentStage(["email"], "fast");
    return { requestId, answer: await answerEmail(input, userId, { conversationId }), agents: ["email"], confidence: 0.96, status: "completed" };
  }
  const publicSearchQuery = resolvePublicSearchQuery(input, context);
  if (publicSearchQuery) {
    prepareAgentStage(["general"], "balanced");
    return { requestId, answer: await answerPublicSearch(publicSearchQuery), agents: ["general"], confidence: 0.96, status: "completed" };
  }
  let intent = classifyDeterministically(input) ?? classifyFollowUp(input, context);
  if (!intent) {
    prepareAgentStage(["orchestrator"], "fast");
    intent = await classifyWithClaude(input, userRef, context);
  }

  if (intent.refusalReason) {
    prepareAgentStage(["orchestrator"], "fast");
    return { requestId, answer: await answerCasual(input, context, "boundary"), agents: [], confidence: 1, status: "completed" };
  }
  if (intent.needsClarification) {
    return {
      requestId,
      answer: intent.clarificationQuestion ?? "I didn’t quite catch that. Which email, calendar item, or spending detail did you mean?",
      agents: intent.intents.map((item) => item.agent),
      confidence: intent.intents.length ? Math.min(...intent.intents.map((item) => item.confidence)) : 1,
      status: "waiting_for_user",
    };
  }

  if (intent.intents.length === 0) {
    return { requestId, answer: "I didn’t quite catch that. Which email, calendar item, or spending detail did you mean?", agents: [], confidence: 1, status: "waiting_for_user" };
  }
  const agents = [...new Set(intent.intents.map((item) => item.agent))];
  prepareAgentStage(agents, agents.length > 1 ? "balanced" : "fast");
  if (agents.length === 1 && agents[0] === "general") {
    prepareAgentStage(["general"], "balanced");
    return { requestId, answer: await answerPublicSearch(resolveAgentInput(input, context, "general")), agents, confidence: intent.intents[0].confidence, status: "completed" };
  }
  if (agents.length === 1 && agents[0] === "calendar") {
    return { requestId, answer: await answerCalendar(input, userId), agents, confidence: intent.intents[0].confidence, status: "completed" };
  }
  if (agents.length === 1 && agents[0] === "finance") {
    return { requestId, answer: await answerFinance(input, userId), agents, confidence: intent.intents[0].confidence, status: "completed" };
  }
  if (agents.length === 1 && agents[0] === "email") {
    return { requestId, answer: await answerEmail(resolveAgentInput(input, context, "email"), userId, { conversationId }), agents, confidence: intent.intents[0].confidence, status: "completed" };
  }

  const outcomes = await executeReadOnlyAgentPlan(intent.intents, input, userId, context);
  const completedCount = outcomes.filter((outcome) => outcome.ok).length;
  return {
    requestId,
    answer: composeMultiAgentAnswer(outcomes),
    agents,
    confidence: Math.min(...intent.intents.map((item) => item.confidence)),
    status: completedCount === outcomes.length ? "completed" : "partially_completed",
  };
}

export function isGreetingOnly(input: string) {
  return /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))[!. ]*$/i.test(input.trim());
}

function resolveAgentInput(input: string, context: ContextMessage[], agent: "email" | "calendar" | "finance" | "general") {
  if (!/^(?:retry|try again|again)[.!]?$/i.test(input.trim())) return input;
  for (let index = context.length - 1; index >= 0; index -= 1) {
    const message = context[index];
    if (message.role !== "user" || /^(?:retry|try again|again)[.!]?$/i.test(message.content.trim())) continue;
    const prior = classifyDeterministically(message.content);
    if (prior?.intents.some((intent) => intent.agent === agent)) return message.content;
  }
  return input;
}

function resolvePublicSearchQuery(input: string, context: ContextMessage[]) {
  if (isPublicSearchQuery(input)) return input;
  if (input.length > 120) return null;
  const refinement = /\b(indian|chinese|mexican|italian|thai|vietnamese|vegetarian|vegan|cheap|casual|upscale|nearby|open now|yes|no)\b/i.test(input);
  if (!refinement) return null;
  for (let index = context.length - 1; index >= 0; index -= 1) {
    if (context[index].role === "user" && isPublicSearchQuery(context[index].content)) return `${context[index].content}. Refine the results using: ${input}`;
  }
  return null;
}


function classifyFollowUp(input: string, context: ContextMessage[]) {
  const normalized = input.trim().toLowerCase();
  const isShortFollowUp = normalized.length <= 120 && (
    /^(?:(?:ok|okay)[,. ]*)?(?:what(?:'s| is)? next|then what|what about (?:that|after that|before that)|and then|after that|before that|go on|continue|retry|try again|again)\??$/.test(normalized)
    || /\b(?:today|tomorrow|yesterday|this week|next week|last week|next\s+\d{1,2}\s+days?)\b/.test(normalized)
  );
  if (!isShortFollowUp) return null;

  for (let index = context.length - 1; index >= 0; index -= 1) {
    if (context[index].role !== "user") continue;
    const previous = classifyDeterministically(context[index].content);
    if (!previous) continue;
    return {
      ...previous,
      intents: previous.intents.map((intent) => ({
        ...intent,
        operation: "continue_query",
        confidence: Math.min(intent.confidence, 0.88),
        instruction: input,
      })),
    };
  }
  return null;
}
