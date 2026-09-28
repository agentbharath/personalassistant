import { notFound } from "next/navigation";
import { Chat } from "@/components/chat/Chat";
import { AppShell } from "@/components/layout/AppShell";
import { signOut } from "@/app/auth/actions";
import { embedCard } from "@/lib/chat/card-payload";
import { MOCK_RECENT, MOCK_THREAD } from "../mock";

/** Development-only signed-in view with mock data, so the chat can be screenshotted and accessibility-checked without a real account. */
export default async function DesignAppPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const view = (await searchParams).view;
  const thread = view === "thread";
  const scan = view === "scan";
  const spending = view === "spending";
  const bills = view === "bills";
  const scanMessages = [
    { role: "user" as const, content: "Import my spending from the last 30 days" },
    { role: "assistant" as const, status: "waiting_for_user", content: "### Review 2 imports\n\n1. **iHerb** — $35.53 · Sep 16\n2. **Discover** — $250.00 · Sep 11 · card payment\n\n500 email summaries checked. **Scan paused** in Primary and Updates. Progress is saved for 7 days. 62 known emails remain; more pages may follow. Choose **Continue scan** to resume where this scan stopped. Continuing does not import anything.\n\nChoose **Confirm** to import the reviewed items or **Cancel**." },
  ];
  const spendingMessages = [
    { role: "user" as const, content: "how was my spending this week?" },
    { role: "assistant" as const, content: embedCard("### Spending · Sep 20 – 27\n\n$484.99", {
      kind: "spending", periodLabel: "Sep 20 – 27", filterLabel: null, currency: "USD", total: 48499, priorTotal: 79300, changePercent: -39,
      comparisonLabel: "vs the week before", insight: "Down 39% vs the week before. Other is the biggest reason spending is down, off $496.50.",
      running: [{ current: 0, prior: 0 }, { current: 4200, prior: 60000 }, { current: 9800, prior: 60000 }, { current: 15600, prior: 60000 }, { current: 22400, prior: 63000 }, { current: 31200, prior: 68000 }, { current: 40100, prior: 74600 }, { current: 48499, prior: 79300 }],
      xTicks: [{ offset: 0, label: "Sun 20" }, { offset: 1, label: "Mon" }, { offset: 2, label: "Tue" }, { offset: 3, label: "Wed" }, { offset: 4, label: "Thu" }, { offset: 5, label: "Fri" }, { offset: 6, label: "Sat" }, { offset: 7, label: "Sun 27" }],
      changes: [
        { category: "other", now: 10350, before: 60650, delta: -50300 },
        { category: "utilities", now: 18777, before: 350, delta: 18427 },
        { category: "entertainment", now: 5697, before: 2534, delta: 3163 },
        { category: "shopping", now: 5532, before: 2930, delta: 2602 },
        { category: "health", now: 0, before: 3553, delta: -3553 },
      ],
      topMerchants: [
        { merchant: "PG&E", amountMinor: 14630, count: 1 },
        { merchant: "Cinemark Theatres", amountMinor: 5697, count: 1 },
        { merchant: "Xfinity", amountMinor: 4147, count: 1 },
        { merchant: "Excel Gas & Mart", amountMinor: 4001, count: 1 },
        { merchant: "Anthropic", amountMinor: 4000, count: 2 },
      ],
      actions: [{ label: "Categorize the $103.50 in Other", query: "help me categorize my Other spending this period" }, { label: "Compare to the week before", query: "compare this to last week" }],
      count: 18, otherCurrencyCount: 0,
    }) },
  ];
  const billsMessages = [
    { role: "user" as const, content: "what's due this week?" },
    { role: "assistant" as const, content: embedCard("### Bills outstanding\n\n$1,284.00", {
      kind: "bills", total: 128400, currency: "USD", count: 3,
      insight: "Chase card is the one to watch. It is due Tuesday and not on autopay.",
      bills: [
        { id: "1", merchant: "Chase card", amountMinor: 84600, currency: "USD", badge: { weekday: "TUE", day: 29 }, status: "Due in 2 days", overdue: false, autopay: false },
        { id: "2", merchant: "PG&E", amountMinor: 13800, currency: "USD", badge: { weekday: "THU", day: 1 }, status: "Autopay on", overdue: false, autopay: true },
        { id: "3", merchant: "Klarna", amountMinor: 30000, currency: "USD", badge: { weekday: "SAT", day: 3 }, status: "Due in 6 days", overdue: false, autopay: false },
      ],
      moreCount: 0, actions: [{ label: "Mark Chase card paid", query: "I paid the Chase card bill" }],
    }) },
  ];
  return <AppShell title={thread ? "iHerb receipts" : "New conversation"} email="you@example.com" signOutAction={signOut} recent={MOCK_RECENT} activeConversationId={thread ? MOCK_RECENT[0].id : undefined}>
    <Chat key={view ?? "empty"} title={thread ? "iHerb receipts" : undefined} conversationId={thread ? MOCK_RECENT[0].id : undefined} initialMessages={scan ? scanMessages : thread ? MOCK_THREAD : spending ? spendingMessages : bills ? billsMessages : []} />
  </AppShell>;
}
