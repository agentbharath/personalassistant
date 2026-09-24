import { prepareEmailDuesImport } from "./email-finance-import";
import { IMPORT_BUDGET } from "@/lib/runtime/import-budget";
import { extendRequestBudget } from "@/lib/runtime/request-context";
import { prepareAgentStage } from "@/lib/runtime/query-budget";
import { Temporal } from "@js-temporal/polyfill";
import { acknowledgeLearning } from "@/lib/learning/commands";
import type { Learnings } from "@/lib/learning/learnings";
import { NO_LEARNINGS } from "@/lib/learning/learnings";
import { loadLearnings, saveLearning } from "@/lib/learning/store";
import { listBills, settleBill } from "@/lib/tools/finance/bills";
import { dueForBillsEmailCheck, lastBillsEmailCheck, recordBillsEmailCheck } from "@/lib/tools/finance/sync-state";
import { readGmailMessage, searchGmail } from "@/lib/tools/email/google-gmail";
import { autopayDue, classifyDocument, matchPayment, outstandingNote, renderBills, sameMerchant, type Bill, type BillsCommand } from "./bills";
import { extractInvoiceFacts } from "./email-invoice";

const TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
const today = () => Temporal.Now.zonedDateTimeISO(TIME_ZONE).toPlainDate().toString();
const MAX_PAYMENT_LOOKUPS = 5;

const money = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
function agoText(when: Date, now: Date) {
  const minutes = Math.round((now.getTime() - when.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
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
 * R17.8: "what do I owe" always shows saved dues right away. A live email sweep for new statements is expensive (it can read hundreds of
 * emails) and pointless to repeat every few minutes, so it runs at most once per `BILLS_EMAIL_RECHECK_MS`; asking again sooner just shows
 * what is saved, with when it last checked. `force` (an explicit "check my email for new bills") always sweeps.
 */
export async function answerBills(userId: string, conversationId?: string, emailWindowDays = 90, force = false) {
  if (conversationId) prepareAgentStage(["finance", "email"]);
  const learnings = await loadLearnings(userId).catch(() => NO_LEARNINGS);
  const settled = await settleAutopayBills(userId, learnings);
  const bills = await listBills(userId, "outstanding");
  const found = conversationId ? [] : await findPaymentEmails(userId, bills);
  const auto = settled.length ? `${settled.map((bill) => `${bill.merchant} (${money(bill.amountMinor, bill.currency)})`).join(", ")} ${settled.length === 1 ? "was" : "were"} on autopay, so I counted ${settled.length === 1 ? "it" : "them"} as paid on the due date.\n\n` : "";
  const saved = `${auto}${renderBills(bills, today(), found)}`;
  if (!conversationId) return saved;

  const now = new Date();
  const lastChecked = await lastBillsEmailCheck(userId).catch(() => null);
  if (!force && !dueForBillsEmailCheck(lastChecked, now)) {
    return `${saved}\n\n_Checked your email for new statements ${agoText(lastChecked!, now)}; it checks again automatically after a few hours._`;
  }

  extendRequestBudget(IMPORT_BUDGET.totalMs, IMPORT_BUDGET.costLimitUsd);
  try {
    const discovered = await prepareEmailDuesImport(userId, conversationId, emailWindowDays);
    await recordBillsEmailCheck(userId, now).catch(() => {});
    return `### Saved dues\n\n${saved}\n\n${discovered}`;
  } catch {
    return `${saved}\n\nI couldn’t finish checking email statements. Your saved dues are shown above; email coverage is incomplete.`;
  }
}

/** R17.5, R17.6, R17.8 */
export async function runBillsCommand(command: BillsCommand, userId: string, options?: { conversationId?: string; emailWindowDays?: number }) {
  if (command.type === "list") return answerBills(userId, options?.conversationId, options?.emailWindowDays);

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
