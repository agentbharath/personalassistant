import { z } from "zod";
import { EMAIL_NOUNS, parseEmailRequest } from "@/lib/agents/email-request";

export const intentResultSchema = z.object({
  intents: z.array(z.object({
    agent: z.enum(["general", "calendar", "email", "finance"]),
    operation: z.string(),
    confidence: z.number().min(0).max(1),
    instruction: z.string(),
  })).max(4),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().nullable(),
  refusalReason: z.string().nullable(),
});

export type IntentResult = z.infer<typeof intentResultSchema>;

const keywordRules = [
  { agent: "finance" as const, words: ["spend", "spent", "receipt", "transaction", "restaurant"] },
  { agent: "calendar" as const, words: ["calendar", "meeting", "schedule", "invite", "free", "available"] },
  { agent: "email" as const, words: ["email", "mail", "inbox", "reply", "send"] },
];

const lookupVerbs = /\b(show|find|search|list|did|do i have|have i|any|all|every|latest|newest|check)\b/;
const documentNouns = /\b(receipts?|invoices?|order confirmations?)\b/;
const financeWriteVerbs = /\b(i spent|i paid|record|add|log|save|import)\b|\$\s?\d/;

// Looking up receipts/invoices is an email search, not a finance write.
function isReceiptLookup(normalized: string) {
  return documentNouns.test(normalized) && lookupVerbs.test(normalized) && !financeWriteVerbs.test(normalized);
}

const spendingWords = /\b(?:spen[dt]|spending|paid|pay|transactions?|expenses?)\b/i;

// Any request that parses as an email request is an email read. This must not depend on a model call.
function isEmailQuery(input: string) {
  if (spendingWords.test(input)) return false;
  const request = parseEmailRequest(input);
  return request.topic !== "general" || request.humansOnly || request.unread || (request.sender !== null && EMAIL_NOUNS.test(input));
}

export function classifyDeterministically(input: string): IntentResult | null {
  const normalized = input.toLowerCase();
  if (isReceiptLookup(normalized) || isEmailQuery(input)) {
    return {
      intents: [{ agent: "email", operation: "handle_query", confidence: 0.9, instruction: input }],
      needsClarification: false,
      clarificationQuestion: null,
      refusalReason: null,
    };
  }
  const matches = keywordRules.filter((rule) => rule.words.some((word) => normalized.includes(word)));
  if (matches.length !== 1) return null;
  const match = matches[0];
  return {
    intents: [{ agent: match.agent, operation: "handle_query", confidence: 0.92, instruction: input }],
    needsClarification: false,
    clarificationQuestion: null,
    refusalReason: null,
  };
}
