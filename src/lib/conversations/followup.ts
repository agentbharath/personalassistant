import { clipTurn, type ContextTurn } from "./context";
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
/** Preserve the actual exchange, including server-saved choices; this does not guess the user's intent. */
export function followupContext(context: ContextTurn[], message: string) {
  const turns = context.filter(turn => !turn.content.startsWith("Earlier conversation summary"));
  const index = turns.findLastIndex(turn => turn.role === "assistant");
  if (index < 0) return null;
  const assistant = turns[index];
  const preceding = turns.slice(0, index).findLast(turn => turn.role === "user");
  const choices = assistant.choices ?? [];
  const exactChoice = choices.find(choice => normalize(choice) === normalize(message));
  return {
    precedingRequest: preceding ? clipTurn(preceding.content, 2000) : null,
    assistantReply: clipTurn(assistant.content, 4000),
    offeredChoices: choices,
    selectedChoice: exactChoice ?? null,
    subsequentUserReplies: [...turns.slice(index + 1).filter(turn => turn.role === "user").map(turn => clipTurn(turn.content, 1000)), message],
    // Nothing here is permission to execute a historical write.
  };
}
const filler = new Set(["do", "you", "want", "would", "like", "to", "see", "the", "a", "an", "or", "your", "for", "me", "should", "i", "please", "can", "could"]);
function questionWords(question: string) {
  return new Set((normalize(question).match(/[\p{L}\p{N}']+/gu) ?? []).filter(word => !filler.has(word)));
}
/** Detect copies/close rewordings only, never use word overlap to route actions or choose a meaning. */
export function sameQuestion(a: string, b: string) {
  const left = questionWords(a), right = questionWords(b);
  if (!left.size || !right.size) return false;
  if (normalize(a).replace(/[^\p{L}\p{N}]/gu, "") === normalize(b).replace(/[^\p{L}\p{N}]/gu, "")) return true;
  const shared = [...left].filter(word => right.has(word)).length;
  return shared >= 3 && shared / Math.max(left.size, right.size) >= 0.8;
}
export function repeatsAnsweredQuestion(question: string | null, context: ContextTurn[], message: string) {
  if (!question) return false;
  const exchange = followupContext(context, message);
  const previous = context.filter(turn => turn.role === "assistant" && !turn.content.startsWith("Earlier conversation summary") && sameQuestion(turn.content, question));
  // A bare "yes" to an either/or can legitimately need one disambiguation. An exact option selection cannot.
  if (!exchange || !sameQuestion(exchange.assistantReply, question)) return false;
  return previous.length >= 2 || Boolean(previous.length && exchange.selectedChoice);
}
export const FOLLOWUP_RULES = `Use followupExchange as the current question/answer pair, not a new task inferred from a short reply. An exact selectedChoice is already answered: continue that task; never ask that choice again. Resolve yes/no against the latest assistant offer, not an unrelated old approval. A yes to multiple alternatives does not select one. A clear new request replaces the earlier topic; a declined offer ends it. Carry forward stated dates, recipients, constraints and corrections, but never invent missing details. Ask only for information essential to the next action, not optional filters with defaults. Check the earlier user answers before asking. Prior tool results are historical facts, not proof of current availability or permission to write.`;
export const CONTINUITY_BLOCKED = "I have your reply, but couldn’t reliably connect it to the earlier request. I haven’t taken any action. Your reply is saved in this chat.";
