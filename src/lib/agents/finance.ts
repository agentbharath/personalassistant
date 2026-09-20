import { Temporal } from "@js-temporal/polyfill";
import { extractTransaction } from "@/lib/model/claude";
import { isCloseSpelling, recencyDays } from "@/lib/agents/email-query";
import { NO_LEARNINGS } from "@/lib/learning/learnings";
import { applyMerchantLearnings, toKnownCategory } from "@/lib/learning/preferences";
import { loadLearnings } from "@/lib/learning/store";
import { outstandingLine } from "@/lib/agents/bills-agent";
import { createTransactionCandidate, listTransactions, type StoredTransaction } from "@/lib/tools/finance/transactions";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";

export async function answerFinance(input: string, userId: string) {
  if (isSpendingQuery(input)) return answerSpending(input, userId);
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

async function answerSpending(input: string, userId: string) {
  const answer = await spendingAnswer(input, userId);
  const note = await outstandingLine(userId);
  return note ? `${answer}\n\n_${note}_` : answer;
}

async function spendingAnswer(input: string, userId: string) {
  const merchant = requestedMerchant(input);
  const range = merchant && !hasExplicitPeriod(input) ? yearRange() : spendingRange(input);
  const category = requestedCategory(input);
  const transactions = (await listTransactions(userId, range.from, range.to))
    .filter((transaction) => transaction.direction === "expense")
    .filter((transaction) => !category || transaction.category.toLowerCase() === category)
    .filter((transaction) => !merchant || merchantMatches(transaction.merchant, merchant));
  if (!transactions.length) {
    return `I don’t have any recorded${category ? ` ${category}` : ""}${merchant ? ` ${merchant}` : ""} spending ${range.label}. ${merchant ? `I can check your email for ${merchant} receipts and prepare an import for your approval—say “import my latest ${merchant} receipt”.` : "You can add transactions by telling me what you spent or importing receipts and eligible emails."}`;
  }
  const currencies = new Set(transactions.map((transaction) => transaction.currency));
  if (currencies.size > 1) return multiCurrencySummary(transactions, range.label, category);
  const total = transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0);
  const currency = transactions[0].currency;
  const top = [...transactions].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 5);
  const broad = range.label === "so far" || range.label === "this year" || /12 months|\d{2,} days/.test(range.label);
  const dates = transactions.map((transaction) => transaction.occurredOn).sort();
  const breakdown = broad && !category && !merchant ? `\n\n**By category**\n${categoryBreakdown(transactions, currency)}` : "";
  const span = range.label === "so far" ? `Recorded from ${dates[0]} to ${dates.at(-1)}.\n\n` : "";
  return `### ${merchant ? transactions[0].merchant : category ? titleCase(category) : "Spending"} ${range.label}\n\n**${formatMoney(total, currency)}** across ${transactions.length} transaction${transactions.length === 1 ? "" : "s"}. ${span}${breakdown}\n\n${broad ? "**Biggest**\n" : ""}${top.map((transaction) => `- **${transaction.merchant}** — ${money(transaction)} · ${transaction.occurredOn}`).join("\n")}`;
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

function merchantMatches(actual: string, requested: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = normalize(actual);
  const r = normalize(requested);
  return a.includes(r) || a.split(" ").some((word) => isCloseSpelling(word, r));
}

function hasExplicitPeriod(input: string) {
  return /\b(this|last)\s+(?:week|month|year)\b|\btoday\b|\byesterday\b/i.test(input) || ALL_TIME.test(input) || recencyDays(input) !== null;
}

function yearRange() {
  const today = Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate();
  return { from: today.subtract({ years: 1 }).toString(), to: today.toString(), label: "in the last 12 months" };
}

function isSpendingQuery(input: string) {
  return /\b(how much|total|summary|summarize|spending|spendings|what did i spend|what are my)\b/i.test(input);
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

function requestedCategory(input: string) {
  const match = ["restaurants", "groceries", "transport", "shopping", "utilities", "entertainment", "software", "health", "housing"]
    .find((category) => input.toLowerCase().includes(category) || (category === "restaurants" && /\b(food|dining|restaurant)\b/i.test(input)));
  return match ?? null;
}

function money(transaction: StoredTransaction) { return formatMoney(transaction.amountMinor, transaction.currency); }
function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}
function titleCase(value: string) { return value[0].toUpperCase() + value.slice(1); }
function joinWords(values: string[]) { return values.length < 2 ? values[0] : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`; }
function multiCurrencySummary(transactions: StoredTransaction[], label: string, category: string | null) {
  const totals = new Map<string, number>();
  for (const transaction of transactions) totals.set(transaction.currency, (totals.get(transaction.currency) ?? 0) + transaction.amountMinor);
  return `### ${category ? titleCase(category) : "Spending"} ${label}\n\n${[...totals].map(([currency, amount]) => `- **${formatMoney(amount, currency)}**`).join("\n")}\n\nCurrencies are kept separate; I won’t apply an unstated exchange rate.`;
}
