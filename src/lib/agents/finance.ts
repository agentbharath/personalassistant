import { answerFinanceQuery } from "./finance-query";
import type { ContextTurn } from "@/lib/conversations/context";
import { Temporal } from "@js-temporal/polyfill";
import { extractTransaction } from "@/lib/model/claude";
import { recencyDays } from "@/lib/agents/email-query";
import { NO_LEARNINGS } from "@/lib/learning/learnings";
import { applyMerchantLearnings, toKnownCategory } from "@/lib/learning/preferences";
import { loadLearnings } from "@/lib/learning/store";
import { createTransactionCandidate, type StoredTransaction } from "@/lib/tools/finance/transactions";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

export async function answerFinance(input: string, userId: string, mode: "read" | "record" = "read", context: ContextTurn[] = []) {
  if (mode === "read") return answerFinanceQuery(input, userId, context);
  const today = Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
  const extracted = await extractTransaction(input, today);
  if (!extracted.isTransaction) {
    return "I’m not sure what you’d like to do. I can record a spend (for example, `I spent $24.50 at Curry Point today`), answer a spending question, or import receipts from your email. Which did you mean?";
  }
  const missing = [
    !extracted.amountMinor && "amount",
    !extracted.merchant && "merchant",
    !extracted.occurredOn && "date",
  ].filter(Boolean);
  if (missing.length) return `I need the ${joinWords(missing as string[])} before I can record this transaction.`;
  // R14.2: learned merchant names and categories apply before anything is recorded.
  const learnings = await loadLearnings(userId).catch(() => NO_LEARNINGS);
  const result = await createTransactionCandidate(userId, applyMerchantLearnings({
    occurredOn: extracted.occurredOn!,
    amountMinor: extracted.amountMinor!,
    currency: extracted.currency ?? "USD",
    direction: extracted.direction ?? "expense",
    merchant: extracted.merchant!,
    category: extracted.category ?? "other",
    note: extracted.note,
  }, learnings).candidate);
  const transaction = result.transaction;
  if (result.duplicate) {
    return `I didn’t add another copy. This looks like ${result.duplicateKind === "exact" ? "the same" : "a matching"} transaction already recorded:\n\n- **${transaction.merchant}** — ${money(transaction)}\n- ${transaction.occurredOn} · ${transaction.category}`;
  }
  return `Recorded:\n\n- **${transaction.merchant}** — ${money(transaction)}\n- ${transaction.occurredOn} · ${transaction.category}\n\nI’ll include it in future spending summaries.`;
}

/** R8.12: totals per category, largest first. */
export function categoryBreakdown(transactions: Array<{ category: string; amountMinor: number }>, currency: string) {
  // Older records kept whatever the model wrote ("Utilities", "Health & Wellness"), so group on the fixed set, ignoring case.
  const totals = new Map<string, { amount: number; count: number }>();
  for (const transaction of transactions) {
    const name = toKnownCategory(transaction.category);
    const entry = totals.get(name) ?? { amount: 0, count: 0 };
    totals.set(name, { amount: entry.amount + transaction.amountMinor, count: entry.count + 1 });
  }
  return [...totals.entries()]
    .sort((left, right) => right[1].amount - left[1].amount || left[0].localeCompare(right[0]))
    .map(([name, entry]) => `- ${titleCase(name)} — ${formatMoney(entry.amount, currency)} · ${entry.count}`)
    .join("\n");
}

const CATEGORY_WORDS = /^(?:restaurants?|food|dining|groceries|transport|shopping|utilities|entertainment|software|health|housing|everything|anything|stuff|things|money)$/i;

const NOT_A_MERCHANT = /^(?:a|an|the|my|me|it|that|this|these|those|much|money|total|so|last|more|less|in|over|since|during|today|yesterday|all|every|each)$/i;

export function requestedMerchant(input: string) {
  const match = input.match(/\b(?:spen[dt]|spending|paid|paying|pay)\s+(?:(?:on|at|to|with|for)\s+)?([\p{L}\p{N}&'.-]+(?:\s+[\p{L}\p{N}&'.-]+){0,2}?)(?=\s+(?:this|last|in|during|today|yesterday|so far|so|over|since|per|each|total|overall|altogether|lifetime)\b|[?.!,]|$)/iu)?.[1]?.trim();
  return match && !CATEGORY_WORDS.test(match) && !NOT_A_MERCHANT.test(match.split(/\s+/)[0]) ? match : null;
}

// R8.12: "so far", "all time", "overall", "to date" mean everything recorded, not this month.
const ALL_TIME = /\b(?:so far|all[- ]time|overall|ever|to date|altogether|in total|lifetime|since i started|all of it|everything)\b/i;

export function spendingRange(input: string) {
  const today = Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate();
  const normalized = input.toLowerCase();
  if (ALL_TIME.test(input)) return { from: "2000-01-01", to: today.toString(), label: "so far" };
  const days = /\blast month\b/i.test(input) ? null : recencyDays(input);
  if (days) return { from: today.subtract({ days }).toString(), to: today.toString(), label: `in the last ${days} days` };
  if (normalized.includes("last month")) {
    const month = today.subtract({ months: 1 }).with({ day: 1 });
    return { from: month.toString(), to: month.add({ months: 1 }).subtract({ days: 1 }).toString(), label: "last month" };
  }
  if (normalized.includes("this year")) return { from: today.with({ month: 1, day: 1 }).toString(), to: today.toString(), label: "this year" };
  if (normalized.includes("this week")) {
    const from = today.subtract({ days: today.dayOfWeek - 1 });
    return { from: from.toString(), to: today.toString(), label: "this week" };
  }
  const from = today.with({ day: 1 });
  return { from: from.toString(), to: today.toString(), label: "this month" };
}

function money(transaction: StoredTransaction) { return formatMoney(transaction.amountMinor, transaction.currency); }
function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}
function titleCase(value: string) { return value[0].toUpperCase() + value.slice(1); }
function joinWords(values: string[]) { return values.length < 2 ? values[0] : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`; }
