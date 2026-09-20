import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { TodayView } from "@/components/today/TodayView";
import { WaitingCard } from "@/components/today/WaitingCard";
import type { WaitingResult } from "@/lib/replies/waiting";
import { signOut } from "@/app/auth/actions";
import type { DailyView } from "@/lib/today/load";
import { MOCK_RECENT } from "../mock";

const bill = (id: string, merchant: string, amountMinor: number, dueDate: string | null) => ({ id, merchant, amountMinor, currency: "USD", category: "utilities", statementDate: "2026-09-01", dueDate, status: "outstanding" as const, paidOn: null });

const MOCK: DailyView = {
  today: "2026-09-21",
  meetingsToday: { state: "ok", value: [
    { id: "e1", summary: "Team standup", start: "2026-09-21T17:00:00Z", end: "2026-09-21T17:30:00Z", allDay: false },
    { id: "e2", summary: "Dentist", start: "2026-09-21T21:00:00Z", end: "2026-09-21T22:00:00Z", allDay: false, location: "Bay Dental" },
  ] },
  meetingsAhead: { state: "ok", value: [{ id: "e3", summary: "Dinner with Sam", start: "2026-09-23T01:00:00Z", end: "2026-09-23T03:00:00Z", allDay: false }] },
  bills: { state: "ok", value: { overdue: [bill("b1", "Comcast", 8999, "2026-09-15")], dueToday: [bill("b2", "PG&E", 15000, "2026-09-21")], dueThisWeek: [bill("b3", "Rent", 240000, "2026-09-28")], noDueDate: [] } },
  spending: { state: "ok", value: { currency: "USD", from: "2026-09-15", to: "2026-09-21", total: 41250, count: 4, previousTotal: 33000, changePercent: 25, dailyAverage: 5893, categories: [
    { category: "groceries", amountMinor: 18000, sharePercent: 44, entries: [{ merchant: "Costco", amountMinor: 11000, occurredOn: "2026-09-16" }, { merchant: "Trader Joe's", amountMinor: 7000, occurredOn: "2026-09-20" }] },
    { category: "restaurants", amountMinor: 12250, sharePercent: 30, entries: [{ merchant: "Curry Point", amountMinor: 12250, occurredOn: "2026-09-18" }] },
    { category: "transport", amountMinor: 6000, sharePercent: 15, entries: [{ merchant: "Uber", amountMinor: 6000, occurredOn: "2026-09-19" }] },
  ], biggest: { merchant: "Costco", amountMinor: 11000, occurredOn: "2026-09-16" }, otherCurrencyCount: 0 } },
};

const NOW = Date.parse("2026-09-21T18:00:00Z");
const day = (days: number) => NOW - days * 86_400_000;
const MOCK_WAITING: WaitingResult = { state: "ok", pending: 0, items: [
  { threadId: "18c2f3a1b2c3d4e5", messageId: "m1", from: "Sam Lee <sam@example.com>", subject: "Signed lease?", receivedAt: day(9), reason: "Sam asks if you can send the signed lease by Friday." },
  { threadId: "18c2f3a1b2c3d4e6", messageId: "m2", from: "Priya Nair <priya@example.com>", subject: "Dinner on Saturday", receivedAt: day(3), reason: "Priya is asking whether 7 pm on Saturday works for you." },
] };

/** Development-only Perch view with mock data. */
export default async function DesignPerchPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  // ?state=connect shows the not-connected and empty states.
  const connect = (await searchParams).state === "connect";
  const view: DailyView = connect
    ? { ...MOCK, meetingsToday: { state: "needs_connection" }, meetingsAhead: { state: "needs_connection" }, bills: { state: "ok", value: { overdue: [], dueToday: [], dueThisWeek: [], noDueDate: [] } }, spending: { state: "ok", value: null } }
    : MOCK;
  return <AppShell title="Perch" email="you@example.com" signOutAction={signOut} recent={MOCK_RECENT} activeView="perch"><TodayView view={view} replies={<WaitingCard result={connect ? { state: "ok", items: [], pending: 0 } : MOCK_WAITING} now={NOW} />} /></AppShell>;
}
