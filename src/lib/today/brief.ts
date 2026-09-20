import { Temporal } from "@js-temporal/polyfill";
import type { Bill } from "@/lib/agents/bills";
import { toKnownCategory } from "@/lib/learning/preferences";

/** The daily view (R26): what is due, what is on, and how spending is going. Everything here is plain arithmetic over saved records, with no model involved. */
export const WEEK_DAYS = 7;

export type BillBuckets = { overdue: Bill[]; dueToday: Bill[]; dueThisWeek: Bill[]; noDueDate: Bill[] };

const byDue = (left: Bill, right: Bill) => (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999");

/** Outstanding bills only (a bill is not spending until it is paid, R17). "This week" is tomorrow through seven days from today. */
export function billBuckets(bills: Bill[], today: string): BillBuckets {
  const horizon = Temporal.PlainDate.from(today).add({ days: WEEK_DAYS }).toString();
  const open = bills.filter((bill) => bill.status === "outstanding").sort(byDue);
  return {
    overdue: open.filter((bill) => bill.dueDate !== null && bill.dueDate < today),
    dueToday: open.filter((bill) => bill.dueDate === today),
    dueThisWeek: open.filter((bill) => bill.dueDate !== null && bill.dueDate > today && bill.dueDate <= horizon),
    noDueDate: open.filter((bill) => bill.dueDate === null),
  };
}

/** Total of a list of bills when they share one currency; null when they mix currencies, because adding them would be wrong. */
export function billsTotal(bills: Bill[]): { amountMinor: number; currency: string } | null {
  if (!bills.length) return null;
  const currency = bills[0].currency;
  return bills.every((bill) => bill.currency === currency) ? { amountMinor: bills.reduce((sum, bill) => sum + bill.amountMinor, 0), currency } : null;
}

export type SpendingRecord = { occurredOn: string; amountMinor: number; currency: string; direction: "expense" | "income"; merchant: string; category: string };

export type WeeklySpending = {
  currency: string;
  /** The seven days ending today, inclusive. */
  from: string;
  to: string;
  total: number;
  count: number;
  previousTotal: number;
  /** Change against the seven days before, as a percentage; null when there was no spending then to compare with. */
  changePercent: number | null;
  dailyAverage: number;
  /** Every category, largest first, each with the purchases in it. Older records spelled categories in different cases, so they are grouped on the fixed set. */
  categories: { category: string; amountMinor: number; sharePercent: number; entries: { merchant: string; amountMinor: number; occurredOn: string }[] }[];
  biggest: { merchant: string; amountMinor: number; occurredOn: string } | null;
  /** Expenses in other currencies that were left out of the totals. */
  otherCurrencyCount: number;
};

/** The dates a caller needs to load: the last seven days and the seven before them. */
export function spendingWindow(today: string) {
  const to = Temporal.PlainDate.from(today);
  return { from: to.subtract({ days: WEEK_DAYS * 2 - 1 }).toString(), to: to.toString() };
}

/** R26: this week's spending habit, from expenses only. Null when nothing was spent in the last seven days. */
export function weeklySpending(records: SpendingRecord[], today: string): WeeklySpending | null {
  const to = Temporal.PlainDate.from(today);
  const from = to.subtract({ days: WEEK_DAYS - 1 }).toString();
  const previousFrom = to.subtract({ days: WEEK_DAYS * 2 - 1 }).toString();
  const expenses = records.filter((record) => record.direction === "expense");
  const thisWeek = expenses.filter((record) => record.occurredOn >= from && record.occurredOn <= today);
  if (!thisWeek.length) return null;

  // The main currency is the one with the most spending; the others are counted, not converted (no silent conversion, FN-013).
  const totals = new Map<string, number>();
  for (const record of thisWeek) totals.set(record.currency, (totals.get(record.currency) ?? 0) + record.amountMinor);
  const currency = [...totals.entries()].sort((left, right) => right[1] - left[1])[0][0];
  const mine = thisWeek.filter((record) => record.currency === currency);
  const total = mine.reduce((sum, record) => sum + record.amountMinor, 0);
  const previousTotal = expenses.filter((record) => record.currency === currency && record.occurredOn >= previousFrom && record.occurredOn < from).reduce((sum, record) => sum + record.amountMinor, 0);

  const groups = new Map<string, SpendingRecord[]>();
  for (const record of mine) {
    const name = toKnownCategory(record.category);
    groups.set(name, [...(groups.get(name) ?? []), record]);
  }
  const categories = [...groups.entries()]
    .map(([category, records]) => ({
      category,
      amountMinor: records.reduce((sum, record) => sum + record.amountMinor, 0),
      records,
    }))
    .sort((left, right) => right.amountMinor - left.amountMinor || left.category.localeCompare(right.category))
    .map(({ category, amountMinor, records }) => ({
      category,
      amountMinor,
      sharePercent: Math.round((amountMinor / total) * 100),
      entries: [...records].sort((left, right) => right.occurredOn.localeCompare(left.occurredOn) || right.amountMinor - left.amountMinor).map(({ merchant, amountMinor: amount, occurredOn }) => ({ merchant, amountMinor: amount, occurredOn })),
    }));
  const biggest = [...mine].sort((left, right) => right.amountMinor - left.amountMinor)[0];

  return {
    currency,
    from,
    to: today,
    total,
    count: mine.length,
    previousTotal,
    changePercent: previousTotal > 0 ? Math.round(((total - previousTotal) / previousTotal) * 100) : null,
    dailyAverage: Math.round(total / WEEK_DAYS),
    categories,
    biggest: { merchant: biggest.merchant, amountMinor: biggest.amountMinor, occurredOn: biggest.occurredOn },
    otherCurrencyCount: thisWeek.length - mine.length,
  };
}

export const money = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
