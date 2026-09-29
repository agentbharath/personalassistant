import { formatDateRange } from "@/lib/dates/display";
import { prepareAgentStage } from "@/lib/runtime/query-budget";
import { Temporal } from "@js-temporal/polyfill";
import { acknowledgeLearning } from "@/lib/learning/commands";
import type { Learnings } from "@/lib/learning/learnings";
import { NO_LEARNINGS } from "@/lib/learning/learnings";
import { loadLearnings, saveLearning } from "@/lib/learning/store";
import { listBills, settleBill } from "@/lib/tools/finance/bills";
import { financeFreshness } from "@/lib/finance-sync/review";
import { billsTotal } from "@/lib/today/brief";
import { readGmailMessage, searchGmail } from "@/lib/tools/email/google-gmail";
import { embedCard, type BillsCardPayload } from "@/lib/chat/card-payload";
import { autopayDue, classifyDocument, matchPayment, outstandingNote, pastDue, renderBills, sameMerchant, type Bill, type BillsCommand } from "./bills";
import { extractInvoiceFacts } from "./email-invoice";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
const today = () => Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
const MAX_PAYMENT_LOOKUPS = 5;

const money = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const isOnAutopay = (merchant: string, autopayMerchants: string[]) => autopayMerchants.some((name) => sameMerchant(merchant, name));

function billStatus(bill: Bill, autopayMerchants: string[], todayIso: string): string {
  if (isOnAutopay(bill.merchant, autopayMerchants)) return "Autopay on";
  if (!bill.dueDate) return "No due date";
  const days = daysBetween(todayIso, bill.dueDate);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

/** The single most urgent outstanding bill drives the card's insight sentence, mirroring how a person would
 * naturally summarize a list: name the one to watch, not restate every row. */
function billsInsight(featured: Bill, autopayMerchants: string[], todayIso: string): string {
  const autopay = isOnAutopay(featured.merchant, autopayMerchants);
  const overdue = featured.dueDate !== null && featured.dueDate < todayIso;
  const weekday = (iso: string) => Temporal.PlainDate.from(iso).toLocaleString("en-US", { weekday: "long" });
  const timing = !featured.dueDate ? "has no due date on file"
    : overdue ? `was due ${weekday(featured.dueDate)}`
    : featured.dueDate === todayIso ? "is due today"
    : `is due ${weekday(featured.dueDate)}`;
  return `${featured.merchant} is the one to watch. It ${timing}${autopay ? " and is on autopay." : ". Autopay status is unknown."}`;
}

/** Past-due first, then soonest due date -- the same ordering `renderBills` already uses for the text answer. */
function orderBills(bills: Bill[], todayIso: string): Bill[] {
  const late = pastDue(bills, todayIso).sort((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? ""));
  const rest = bills.filter((bill) => !late.includes(bill)).sort((left, right) => (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999"));
  return [...late, ...rest];
}

const SHOWN_BILLS = 5;

function buildBillsCard(bills: Bill[], autopayMerchants: string[], todayIso: string): BillsCardPayload | null {
  if (!bills.length) return null;
  const ordered = orderBills(bills, todayIso);
  const shown = ordered.slice(0, SHOWN_BILLS);
  const totals = billsTotal(bills);
  const featured = ordered[0];
  return {
    kind: "bills",
    total: totals?.amountMinor ?? null,
    currency: totals?.currency ?? bills[0].currency,
    count: bills.length,
    insight: billsInsight(featured, autopayMerchants, todayIso),
    bills: shown.map((bill) => ({
      id: bill.id, merchant: bill.merchant, amountMinor: bill.amountMinor, currency: bill.currency,
      badge: bill.dueDate ? { weekday: Temporal.PlainDate.from(bill.dueDate).toLocaleString("en-US", { weekday: "short" }).toUpperCase(), day: Temporal.PlainDate.from(bill.dueDate).day } : null,
      status: billStatus(bill, autopayMerchants, todayIso),
      overdue: bill.dueDate !== null && bill.dueDate < todayIso,
      autopay: isOnAutopay(bill.merchant, autopayMerchants) ? true : null,
    })),
    moreCount: Math.max(0, ordered.length - shown.length),
    actions: [{ label: `Mark ${featured.merchant} paid`, query: `I paid the ${featured.merchant} bill` }],
  };
}

/** R17.6: a bill of a declared-autopay merchant counts as paid on its due date. Runs before any answer that depends on bills. */
export async function settleAutopayBills(userId: string, learnings: Learnings) {
  if (!learnings.autopay.length) return [];
  const due = autopayDue(await listBills(userId, "outstanding"), learnings.autopay, today());
  const settled: Bill[] = [];
  for (const bill of due) {
    const result = await settleBill(userId, bill.id, bill.dueDate!, { type: "user_input" });
    if (!result.duplicate) settled.push(bill);
  }
  return settled;
}

/** R17.3: the line spending answers add when bills are outstanding. Never blocks an answer. */
export async function outstandingLine(userId: string) {
  try {
    await settleAutopayBills(userId, await loadLearnings(userId).catch(() => NO_LEARNINGS));
    return outstandingNote(await listBills(userId, "outstanding"), today());
  } catch {
    return "";
  }
}

/** R17.8: look for a matching payment email for a few bills, so the user can confirm instead of remembering. */
async function findPaymentEmails(userId: string, bills: Bill[]) {
  const found: Array<{ billId: string; date: string; amountMinor: number }> = [];
  for (const bill of bills.slice(0, MAX_PAYMENT_LOOKUPS)) {
    try {
      const name = bill.merchant.replaceAll('"', "");
      const after = bill.statementDate.replaceAll("-", "/");
      const messages = await searchGmail(userId, `{from:"${name}" "${name}"} {subject:payment subject:"received your payment" subject:autopay} after:${after}`, 10);
      for (const message of messages.filter((item) => classifyDocument(item.subject) === "payment")) {
        const email = await readGmailMessage(userId, message.id);
        const amount = extractInvoiceFacts(email).amount;
        if (!amount) continue;
        const amountMinor = Math.round(Number.parseFloat(amount.replace(/[$,]/g, "")) * 100);
        const date = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(email.date || message.receivedAt));
        if (matchPayment([bill], { merchant: bill.merchant, amountMinor, currency: "USD", date })) { found.push({ billId: bill.id, date, amountMinor }); break; }
      }
    } catch {
      // A failed lookup only means no suggestion for this bill.
    }
  }
  return found;
}

/**
 * R17.8: "what do I owe" shows saved dues right away and never sweeps email inline. New statements come from the same background,
 * watermarked email sync `finance_spending` already uses (`finance-sync/`, queued at sign-in and advanced by a cron job): this only reads
 * that sync's status and reports it, exactly as `financeFreshness` does for a spending question. A found bill or card-payment candidate is
 * reviewed on Perch, the same review card used for spending.
 */
export async function answerBills(userId: string, conversationId?: string, input = "") {
  if (conversationId) prepareAgentStage(["finance", "email"]);
  const learnings = await loadLearnings(userId).catch(() => NO_LEARNINGS);
  const settled = await settleAutopayBills(userId, learnings);
  const window = billsWindow(input, today());
  const bills = (await listBills(userId, "outstanding")).filter(bill => !window || bill.dueDate !== null && bill.dueDate >= window.from && bill.dueDate <= window.to);
  const found = conversationId ? [] : await findPaymentEmails(userId, bills);
  const auto = settled.length ? `${settled.map((bill) => `${bill.merchant} (${money(bill.amountMinor, bill.currency)})`).join(", ")} ${settled.length === 1 ? "was" : "were"} on autopay, so I counted ${settled.length === 1 ? "it" : "them"} as paid on the due date.\n\n` : "";
  const saved = `${window ? `Due · ${window.label}\n\n` : ""}${auto}${window && !bills.length ? "No saved bills are due in this window. Bills without a due date are not included." : renderBills(bills, today(), found)}`;
  if (!conversationId) return saved;
  const freshness = await financeFreshness(userId, conversationId).catch(() => ({ note: "Email sync is unavailable. This answer uses saved dues only.", review: false }));
  const text = [saved, freshness.note].filter(Boolean).join("\n\n");
  const card = buildBillsCard(bills, learnings.autopay, today());
  return card ? embedCard(text, { ...card, periodLabel: window?.label }) : text;
}

/** R17.5, R17.6, R17.8 */
export async function runBillsCommand(command: BillsCommand, userId: string, options?: { conversationId?: string; input?: string }) {
  if (command.type === "list") return answerBills(userId, options?.conversationId, options?.input);

  if (command.type === "autopay") {
    const learning = { kind: "autopay", merchant: command.merchant } as const;
    try {
      await saveLearning(userId, learning);
    } catch {
      return "I couldn't save that just now, so I won't remember it next time. Try again in a moment.";
    }
    const settled = await settleAutopayBills(userId, { ...NO_LEARNINGS, autopay: [command.merchant.toLowerCase()] });
    return `${acknowledgeLearning(learning)}${settled.length ? `\n\nCounted ${settled.length} past-due ${command.merchant} bill${settled.length === 1 ? "" : "s"} as paid on the due date${settled.length === 1 ? "" : "s"}.` : ""}`;
  }

  const matching = (await listBills(userId, "outstanding")).filter((bill) => sameMerchant(bill.merchant, command.merchant)).sort((left, right) => left.statementDate.localeCompare(right.statementDate));
  if (!matching.length) return `I don't have an outstanding ${command.merchant} bill. If you paid something I never recorded, tell me the amount, for example “I paid $146.30 to ${command.merchant}”.`;
  const bill = matching[0];
  const paidOn = command.paidOn ?? today();
  const result = await settleBill(userId, bill.id, paidOn, { type: "user_input" });
  const more = matching.length > 1 ? ` You have ${matching.length - 1} more ${bill.merchant} bill${matching.length === 2 ? "" : "s"} outstanding.` : "";
  return `Marked your ${bill.merchant} bill paid: ${money(bill.amountMinor, bill.currency)} on ${day(paidOn)}. ${bill.paymentDirection === "transfer" ? "It is recorded as a transfer, not new spending" : "It now counts as spending"}${result.duplicate ? " (it was already in your records, so nothing was added twice)" : ""}.${more}`;
}

/** Inclusive due dates: today through N days from today. Undated bills cannot be placed in a window. */
export function billsWindow(input: string, today: string) {
 const start=Temporal.PlainDate.from(today);
 const n=input.match(/\b(?:next|coming|within)\s+(\d{1,3})\s*(?:days?|fays?)\b/i);
 if(n) { const to=start.add({days:Number(n[1])}).toString(); return {from:today,to,label:`Next ${n[1]} days · ${formatDateRange(today,to)}`}; }
 if(/\btomorrow\b/i.test(input)) {const date=start.add({days:1}).toString(); return {from:date,to:date,label:"Tomorrow"};}
 if(/\btoday\b/i.test(input)) return {from:today,to:today,label:"Today"};
 if(/\bthis week\b/i.test(input)) return {from:today,to:start.add({days:7-start.dayOfWeek}).toString(),label:"Rest of this week"};
 if(/\bthis month\b/i.test(input)) return {from:today,to:start.with({day:1}).add({months:1}).subtract({days:1}).toString(),label:"Rest of this month"};
 return null;
}
