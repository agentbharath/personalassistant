import { notFound } from "next/navigation";
import { Chat } from "@/components/chat/Chat";
import { AppShell } from "@/components/layout/AppShell";
import { signOut } from "@/app/auth/actions";
import { embedCard } from "@/lib/chat/card-payload";
import { renderDailyView } from "@/lib/today/answer";
import { buildDayCard, buildTimelineCard } from "@/lib/today/day-card";
import type { DailyView } from "@/lib/today/load";
import { MOCK_RECENT, MOCK_THREAD } from "../mock";

/** Development-only signed-in view with mock data, so the chat can be screenshotted and accessibility-checked without a real account. */
export default async function DesignAppPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const view = (await searchParams).view;
  const thread = view === "thread";
  const scan = view === "scan";
  const spending = view === "spending";
  const spendingSimple = view === "spending-simple";
  const bills = view === "bills";
  const day = view === "day";
  const email = view === "email";
  const recall = view === "recall";
  const calendarQuery = view === "calendar-query";
  const weather = view === "weather";
  const stock = view === "stock";
  const score = view === "score";
  const scores = view === "scores";
  const verdict = view === "verdict";
  const digest = view === "digest";
  const scanMessages = [
    { role: "user" as const, content: "Import my spending from the last 30 days" },
    { role: "assistant" as const, status: "waiting_for_user", content: "### Review 2 imports\n\n1. **iHerb** — $35.53 · Sep 16\n2. **Discover** — $250.00 · Sep 11 · card payment\n\n500 email summaries checked. **Scan paused** in Primary and Updates. Progress is saved for 7 days. 62 known emails remain; more pages may follow. Choose **Continue scan** to resume where this scan stopped. Continuing does not import anything.\n\nChoose **Confirm** to import the reviewed items or **Cancel**." },
  ];
  const spendingMessages = [
    { role: "user" as const, content: "how was my spending this week?" },
    { role: "assistant" as const, content: embedCard("### Spending · Sep 20 – 27\n\n$484.99", {
      kind: "spending", priorPeriodLabel: "Sep 12, 2026 – Sep 19, 2026", periodLabel: "Sep 20, 2026 – Sep 27, 2026", filterLabel: null, currency: "USD", total: 48499, priorTotal: 79300, changePercent: -39,
      comparisonLabel: "vs the week before", insight: "Other had the largest change: $503.00 less than the previous period.",
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
      categories: [],
      actions: [{ label: "Categorize the $103.50 in Other", query: "help me categorize my Other spending this period" }, { label: "Compare to the week before", query: "compare this to last week" }],
      count: 18, otherCurrencyCount: 0,
    }) },
  ];
  const spendingSimpleMessages = [
    { role: "user" as const, content: "how much did I spend this month?" },
    { role: "assistant" as const, content: embedCard("### Spending · September\n\n$642.00", {
      kind: "spending", periodLabel: "Sep 1, 2026 – Sep 28, 2026", priorPeriodLabel: "Aug 1, 2026 – Aug 28, 2026", filterLabel: "food", currency: "USD", total: 64200, priorTotal: 73000, changePercent: -12,
      comparisonLabel: "vs last month", insight: "Under last month. Groceries are steady, delivery is where it goes.",
      running: [], xTicks: [], changes: [], topMerchants: [], actions: [],
      categories: [
        { category: "groceries", amountMinor: 31800, sharePercent: 50 },
        { category: "delivery", amountMinor: 19600, sharePercent: 30 },
        { category: "restaurants", amountMinor: 9800, sharePercent: 15 },
        { category: "coffee", amountMinor: 3000, sharePercent: 5 },
      ],
      count: 34, otherCurrencyCount: 0,
    }) },
  ];
  const emptySpendingMessages = [
    {role:"user" as const,content:"how was my spending this week"},
    {role:"assistant" as const,content:embedCard("This week starts Monday, Sep 28, so this covers today only. No saved expenses match today.",{
      kind:"spending",empty:true,periodLabel:"This week · Sep 28, 2026",filterLabel:null,currency:"USD",total:0,priorTotal:0,changePercent:null,comparisonLabel:"",
      insight:"This week starts Monday, Sep 28, so this covers today only. No saved expenses match today.",running:[],xTicks:[],changes:[],topMerchants:[],categories:[],count:0,otherCurrencyCount:0,
      actions:[{label:"Last 7 days",query:"Show my spending for the last 7 days"},{label:"Last week",query:"Show my spending for last week"}],
    })},
  ];
  const billsMessages = [
    { role: "user" as const, content: "what's due this week?" },
    { role: "assistant" as const, content: embedCard("### Bills outstanding\n\n$1,284.00", {
      kind: "bills", total: 128400, currency: "USD", count: 3,
      insight: "Chase card is the one to watch. It is due Tuesday. Autopay status is unknown.",
      bills: [
        { id: "1", merchant: "Chase card", amountMinor: 84600, currency: "USD", badge: { weekday: "TUE", day: 29 }, status: "Due in 2 days", overdue: false, autopay: null },
        { id: "2", merchant: "PG&E", amountMinor: 13800, currency: "USD", badge: { weekday: "THU", day: 1 }, status: "Autopay on", overdue: false, autopay: true },
        { id: "3", merchant: "Klarna", amountMinor: 30000, currency: "USD", badge: { weekday: "SAT", day: 3 }, status: "Due in 6 days", overdue: false, autopay: null },
      ],
      moreCount: 0, actions: [{ label: "Mark Chase card paid", query: "I paid the Chase card bill" }],
    }) },
  ];
  const dailyView: DailyView = {
    today: "2026-09-28",
    meetingsToday: { state: "ok", value: [
      { id: "1", summary: "Standup", start: "2026-09-28T16:30:00Z", end: "2026-09-28T16:45:00Z", allDay: false },
      { id: "2", summary: "Design review", start: "2026-09-28T18:00:00Z", end: "2026-09-28T19:00:00Z", allDay: false },
      { id: "3", summary: "1:1", start: "2026-09-28T20:00:00Z", end: "2026-09-28T20:30:00Z", allDay: false },
      { id: "4", summary: "Sprint planning", start: "2026-09-28T23:00:00Z", end: "2026-09-29T00:00:00Z", allDay: false },
    ] },
    meetingsAhead: { state: "ok", value: [] },
    bills: { state: "ok", value: { overdue: [], dueToday: [], dueThisWeek: [{ id: "b1", merchant: "Chase card", amountMinor: 84600, currency: "USD", category: "other", statementDate: "2026-09-01", dueDate: "2026-09-29", status: "outstanding", paidOn: null }], dueLater: [], noDueDate: [] } },
    spending: { state: "ok", value: { currency: "USD", from: "2026-09-21", to: "2026-09-27", total: 32506, count: 8, previousTotal: 89000, changePercent: -63, dailyAverage: 4644, categories: [{ category: "groceries", amountMinor: 15000, sharePercent: 46, entries: [] }], biggest: { merchant: "Trader Joe's", amountMinor: 8000, occurredOn: "2026-09-24" }, otherCurrencyCount: 0 } },
    spendingToday: { state: "ok", value: { currency: "USD", from: "2026-09-28", to: "2026-09-28", total: 1899, count: 1, previousTotal: 0, changePercent: null, dailyAverage: 1899, categories: [{ category: "restaurants", amountMinor: 1899, sharePercent: 100, entries: [] }], biggest: { merchant: "Philz Coffee", amountMinor: 1899, occurredOn: "2026-09-28" }, otherCurrencyCount: 0 } },
  };
  const dayMessages = [
    { role: "user" as const, content: "what does my day look like?" },
    { role: "assistant" as const, content: embedCard(renderDailyView(dailyView, { includeMeetings: false }), buildDayCard(dailyView, "2026-09-28T17:40:00Z")!) },
  ];
  const emailMessages = [
    { role: "user" as const, content: "anything important in my email?" },
    { role: "assistant" as const, content: embedCard("### Since yesterday · 38 new\n\n**2 need you**", {
      kind: "email", sinceLabel: "Since yesterday", totalCount: 38, needCount: 2,
      insight: "One reply by Wednesday, one signature. Everything else can wait.",
      highlights: [
        { id: "1", sender: "Recruiting Team", initials: "RT", subject: "Scheduling your onsite", time: "8:12 AM", hint: "Reply by Wed" },
        { id: "2", sender: "DocuSign", initials: "D", subject: "Lease renewal ready to sign", time: "Yesterday", hint: "Signature needed" },
      ],
      othersCount: 36, othersSummary: "newsletters, receipts, updates",
    }) },
  ];
  const recallMessages = [
    { role: "user" as const, content: "Find the restaurant recommendation from last week and check if Friday evening is free." },
    { role: "assistant" as const, content: embedCard("### Friday evening is free. Restaurant from last week needs your help.", {
      kind: "recall-availability", headline: "Friday evening is free. Restaurant from last week needs your help.",
      availability: {
        dateLabel: "Friday, Oct 2 · evening", note: "Nothing on your calendar after 5 PM.", free: true,
        segments: [{ kind: "free", label: "Free", widthPercent: 100 }],
        ticks: ["5 PM", "7 PM", "9 PM", "11 PM"],
      },
      recall: {
        question: "Restaurant from last week",
        note: "I don't have a record of recommending one. These came up when you searched sushi on Sep 26. Which was it?",
        resolvedName: null,
        candidates: [
          { id: "1", name: "Katana Sushi & Sake" }, { id: "2", name: "Senro Sunnyvale" }, { id: "3", name: "Enka Japanese Izakaya" },
          { id: "4", name: "Sushi Boat" }, { id: "5", name: "KOKO izakaya and oyster house" },
        ],
        moreCount: 4,
      },
      planQuery: "It was {name}. Plan that for it.", noneQuery: "None of those were it.",
    }) },
  ];
  const calendarQueryMessages = [
    { role: "user" as const, content: "what's my calendar looking like tomorrow" },
    { role: "assistant" as const, content: embedCard(
      "Here’s your calendar tomorrow:\n• Discussion on Plaid integration with Daylark — Tue, Sep 29, 9:00 AM–10:00 AM\n• Discussion of Daylark's future — Tue, Sep 29, 3:00 PM–3:30 PM",
      buildTimelineCard(
        [
          { id: "1", summary: "Discussion on Plaid integration with Daylark", start: "2026-09-29T16:00:00Z", end: "2026-09-29T17:00:00Z", allDay: false },
          { id: "2", summary: "Discussion of Daylark's future", start: "2026-09-29T22:00:00Z", end: "2026-09-29T22:30:00Z", allDay: false },
        ],
        "Tuesday, September 29", "2026-09-28T23:00:00Z", { dayWord: "tomorrow", standalone: true },
      ),
    ) },
  ];
  const weatherMessages = [
    { role: "user" as const, content: "what's the weather outside" },
    { role: "assistant" as const, content: embedCard("### Now · Sunnyvale\n\n77° Sunny", {
      kind: "weather", eyebrow: "Now · Sunnyvale", headline: "77°", condition: "Sunny",
      insight: "Warm and clear. Peaks at 79° around 3 PM, then cools fast after sunset.",
      rangeLow: 54, rangeHigh: 79, current: 77,
      hourly: [{ label: "Now", value: 77, highlighted: true }, { label: "1PM", value: 78, highlighted: false }, { label: "2PM", value: 79, highlighted: false }, { label: "3PM", value: 79, highlighted: false }, { label: "4PM", value: 77, highlighted: false }, { label: "5PM", value: 74, highlighted: false }],
      hourlyUnit: "temp",
      stats: [{ label: "Wind", value: "7 mph NW" }, { label: "UV", value: "7 · High" }, { label: "Humidity", value: "38%" }],
      attribution: "open-meteo.com · updated 2 min ago",
    }) },
    { role: "user" as const, content: "is it foggy for my run tomorrow?" },
    { role: "assistant" as const, content: embedCard("### Tomorrow · 6 to 8 AM\n\n54° Fog", {
      kind: "weather", eyebrow: "Tomorrow · 6 to 8 AM", headline: "54°", condition: "Fog",
      insight: "Low fog until about 9, visibility near a mile. Roads stay dry. Clears by 10.",
      rangeLow: 53, rangeHigh: 71, current: 54,
      hourly: [{ label: "6AM", value: 54, highlighted: true }, { label: "7AM", value: 54, highlighted: false }, { label: "8AM", value: 55, highlighted: false }, { label: "9AM", value: 58, highlighted: false }, { label: "10AM", value: 62, highlighted: false }, { label: "11AM", value: 66, highlighted: false }],
      hourlyUnit: "temp",
      stats: [{ label: "Visibility", value: "1 mi" }, { label: "Wind", value: "4 mph W" }, { label: "Humidity", value: "92%" }],
      attribution: "open-meteo.com · updated 2 min ago",
    }) },
    { role: "user" as const, content: "do I need an umbrella Thursday?" },
    { role: "assistant" as const, content: embedCard("### Thursday · chance of rain\n\nYes Rain, 2 to 7 PM", {
      kind: "weather", eyebrow: "Thursday · chance of rain", headline: "Yes", condition: "Rain, 2 to 7 PM",
      insight: "Showers all afternoon, heaviest around 5, right in your commute window.",
      rangeLow: 52, rangeHigh: 63, current: 58,
      hourly: [{ label: "1PM", value: 20, highlighted: false }, { label: "2PM", value: 60, highlighted: true }, { label: "3PM", value: 70, highlighted: true }, { label: "4PM", value: 80, highlighted: true }, { label: "5PM", value: 90, highlighted: true }, { label: "6PM", value: 70, highlighted: true }],
      hourlyUnit: "precip",
      stats: [{ label: "Total", value: "0.4 in" }, { label: "Wind", value: "14 mph S" }, { label: "Gusts", value: "25 mph" }],
      attribution: "open-meteo.com · updated 2 min ago",
    }) },
    { role: "user" as const, content: "will it be clear tonight?" },
    { role: "assistant" as const, content: embedCard("### Tonight · Sunnyvale\n\n58° Clear", {
      kind: "weather", eyebrow: "Tonight · Sunnyvale", headline: "58°", condition: "Clear",
      insight: "Clear all night, down to 51° by dawn. Calm winds. Bring a layer if you head out.",
      rangeLow: 51, rangeHigh: 64, current: 58,
      hourly: [{ label: "8PM", value: 58, highlighted: true }, { label: "9PM", value: 56, highlighted: false }, { label: "10PM", value: 55, highlighted: false }, { label: "11PM", value: 54, highlighted: false }, { label: "12AM", value: 53, highlighted: false }, { label: "1AM", value: 52, highlighted: false }],
      hourlyUnit: "temp",
      stats: [{ label: "Wind", value: "3 mph" }, { label: "Humidity", value: "70%" }, { label: "Sunrise", value: "7:03 AM" }],
      attribution: "open-meteo.com · updated 2 min ago",
    }) },
  ];
  const scoreMessages = [
    { role: "user" as const, content: "India vs West Indies score?" },
    { role: "assistant" as const, content: embedCard("### 1st ODI, Thiruvananthapuram · Sep 27", {
      kind: "score", match: "1st ODI, Thiruvananthapuram · Sep 27", status: { label: "Final", tone: "final" },
      teams: [{ name: "West Indies", score: "295/7", detail: "50 ov", lead: false }, { name: "India", score: "300/2", detail: "41.4 ov", lead: true }],
      outcome: { kind: "result", text: "India won by 8 wickets", detail: "with 50 balls left", rates: [] },
      tables: [
        { title: "Top batters", columns: ["Runs"], rows: [{ player: "Virat Kohli", side: "India", stats: ["139"] }, { player: "Shubman Gill", side: "India", stats: ["110"] }, { player: "Justin Greaves", side: "West Indies", stats: ["101"] }] },
        { title: "Top bowlers", columns: ["Wickets"], rows: [{ player: "Kuldeep Yadav", side: "India", stats: ["4"] }, { player: "Prasidh Krishna", side: "India", stats: ["2"] }] },
      ],
      facts: [{ label: "Player of the match", value: "Kuldeep Yadav" }, { label: "Toss", value: "India, elected to field first" }, { label: "Series", value: "India led the 3-match series 1-0 · Next: 2nd ODI Sep 30, Guwahati" }],
      sources: [{ label: "espn.com", url: "https://www.espn.com/cricket/" }],
      chips: [{ label: "Full scorecard", url: "https://www.espn.com/cricket/" }, { label: "Add 2nd ODI to calendar", act: true, text: "Add the 2nd ODI to my calendar" }, { label: "Other cricket today", text: "Any cricket scores today?" }],
    }) },
    { role: "user" as const, content: "What's the live Ind vs Wi cricket score" },
    { role: "assistant" as const, content: embedCard("### 2nd ODI, Guwahati · Sep 30", {
      kind: "score", match: "2nd ODI, Guwahati · Sep 30", status: { label: "Live", tone: "live" },
      teams: [{ name: "West Indies", score: "405/7", detail: "", lead: false }, { name: "India", score: "372/2", detail: "40/50 ov", lead: true }],
      outcome: { kind: "chase", text: "India need 34 from 60 balls", detail: "", rates: ["CRR 9.30", "RRR 3.40"] },
      tables: [{ title: "Top batters", columns: ["Runs"], rows: [{ player: "Shubman Gill", side: "India", stats: ["216"] }, { player: "Amir Jangoo", side: "West Indies", stats: ["114"] }] }],
      facts: [{ label: "Toss", value: "India, elected to field first" }],
      sources: [{ label: "espn.com", url: "https://www.espn.com/cricket/" }],
      chips: [{ label: "Other cricket today", text: "Any cricket scores today?" }],
    }) },
  ];
  const scoresMessages = [
    { role: "user" as const, content: "Any cricket scores today?" },
    { role: "assistant" as const, content: embedCard("### Cricket scores today", {
      kind: "scores", kindLabel: "Cricket scores today", freshness: "",
      events: [
        { label: "Cricket · 2nd ODI · Guwahati", tag: { label: "Live", tone: "live" }, sides: [{ name: "West Indies", score: "405/7", detail: "", lead: false }, { name: "India", score: "372/2", detail: "40/50 ov", lead: true }], outcome: "" },
        { label: "Cricket · 3rd ODI · Potchefstroom", tag: { label: "Sep 30 · 14:00 local", tone: "highlight" }, sides: [{ name: "South Africa", score: "", detail: "", lead: false }, { name: "Australia", score: "", detail: "", lead: false }], outcome: "" },
        { label: "Cricket · 1st ODI · Thiruvananthapuram", tag: { label: "Final", tone: "neutral" }, sides: [{ name: "West Indies", score: "295/7", detail: "", lead: false }, { name: "India", score: "300/2", detail: "41.4/50 ov", lead: true }], outcome: "India won by 8 wickets" },
      ],
      sources: [{ label: "espn.com", url: "https://www.espn.com/cricket/scores" }],
    }) },
  ];
  const verdictMessages = [
    { role: "user" as const, content: "Are they good?" },
    { role: "assistant" as const, content: embedCard("### Verdict on the 5 jackets above", {
      kind: "verdict", kindLabel: "Verdict on the 5 jackets above", basis: "Based on ratings and reviews",
      bottomLine: "Around $70, get the Cotopaxi Abrazo. Under $40, Lands\u2019 End over Amazon.",
      rows: [
        { name: "Cotopaxi Abrazo", metric: "$74.83", detail: "4.7 \u2605 from 135 reviews, deepest discount", tag: { label: "Good buy", tone: "good" } },
        { name: "REI Trailmade", metric: "$69.95", detail: "4.6 \u2605, heavier and more durable", tag: { label: "Good buy", tone: "good" } },
        { name: "Patagonia Better Sweater", metric: "$169", detail: "4.5 \u2605 from 660 reviews, lasts for years", tag: { label: "Best long-term", tone: "highlight" } },
        { name: "Lands\u2019 End fleece", metric: "from $32.97", detail: "Thicker than most at this price", tag: { label: "Solid budget", tone: "neutral" } },
        { name: "Amazon full-zip polar fleece", metric: "~$24", detail: "Thin, can pill with washing", tag: { label: "Occasional wear", tone: "catch" } },
      ],
      sources: [{ label: "rei.com", url: "https://www.rei.com" }, { label: "landsend.com", url: "https://www.landsend.com" }],
      chips: ["Compare Abrazo vs Trailmade", "Show Lands\u2019 End options", "Back to all offers"],
    }) },
  ];
  const digestMessages = [
    { role: "user" as const, content: "Any cricket news?" },
    { role: "assistant" as const, content: embedCard("### Cricket news", {
      kind: "digest", kindLabel: "Cricket news", freshness: "As of Sep 29, 9:40 AM",
      summary: "India chased down 296 with plenty to spare in the 1st ODI. Rain wiped out both Asian Games quarter-finals yesterday.",
      sections: [
        { kind: "events", title: "Result", events: [{ label: "1st ODI \u00b7 Thiruvananthapuram \u00b7 Sep 27", tag: { label: "India won by 8 wickets", tone: "good" }, sides: [{ name: "West Indies", score: "295/7", detail: "50 ov", lead: false }, { name: "India", score: "300/2", detail: "41.4 ov", lead: true }], outcome: "" }] },
        { kind: "list", title: "Abandoned", rows: [{ name: "India vs Afghanistan", meta: "Asian Games \u00b7 T20I QF \u00b7 Sep 28", tag: { label: "Rain", tone: "catch" } }, { name: "Pakistan vs Hong Kong", meta: "Asian Games \u00b7 T20I QF \u00b7 Sep 28", tag: { label: "Rain", tone: "catch" } }] },
        { kind: "tiles", title: "Coming up", tiles: [{ month: "SEP", day: "30", name: "India vs West Indies", meta: "2nd ODI \u00b7 Guwahati \u00b7 14:00 local", next: true }, { month: "OCT", day: "1", name: "Asian Games SF 1", meta: "14:00 local", next: false }] },
      ],
      sources: [{ label: "hindustantimes.com", url: "https://www.hindustantimes.com" }, { label: "ndtv.com", url: "https://www.ndtv.com" }, { label: "espn.com", url: "https://www.espn.com/cricket/" }],
      chips: [{ label: "Live score, 2nd ODI", text: "What's the live India vs West Indies cricket score" }, { label: "Add 2nd ODI to calendar", text: "Add the 2nd ODI to my calendar", act: true }, { label: "Other cricket today", text: "Any cricket scores today?" }],
    }) },
  ];
  const stockMessages = [
    { role: "user" as const, content: "what's Apple stock at" },
    { role: "assistant" as const, content: embedCard("### AAPL · Apple Inc\n\n$254.32 +$1.24 (0.49%)", {
      kind: "stock", eyebrow: "AAPL · Apple Inc", headline: "$254.32", changeLabel: "+$1.24 (0.49%)", changeDirection: "up",
      insight: "Up 0.49% today.", rangeLow: 251.90, rangeHigh: 255.10, current: 254.32, isMarketOpen: true,
      stats: [{ label: "Prev close", value: "$253.08" }, { label: "Volume", value: "42.8M" }, { label: "Exchange", value: "NASDAQ" }],
      attribution: "twelvedata.com · updated just now",
    }) },
    { role: "user" as const, content: "how's Tesla doing today" },
    { role: "assistant" as const, content: embedCard("### TSLA · Tesla, Inc.\n\n$412.87 -$8.53 (2.02%)", {
      kind: "stock", eyebrow: "TSLA · Tesla, Inc.", headline: "$412.87", changeLabel: "-$8.53 (2.02%)", changeDirection: "down",
      insight: "Down 2.02% today; market is closed.", rangeLow: 408.10, rangeHigh: 424.60, current: 412.87, isMarketOpen: false,
      stats: [{ label: "Prev close", value: "$421.40" }, { label: "Volume", value: "89.3M" }, { label: "Exchange", value: "NASDAQ" }],
      attribution: "twelvedata.com · updated just now",
    }) },
  ];
  return <AppShell title={thread ? "iHerb receipts" : "New conversation"} email="you@example.com" signOutAction={signOut} recent={MOCK_RECENT} activeConversationId={thread ? MOCK_RECENT[0].id : undefined}>
    <Chat key={view ?? "empty"} title={thread ? "iHerb receipts" : undefined} conversationId={thread ? MOCK_RECENT[0].id : undefined} initialMessages={view === "spending-empty" ? emptySpendingMessages : scan ? scanMessages : thread ? MOCK_THREAD : spending ? spendingMessages : spendingSimple ? spendingSimpleMessages : bills ? billsMessages : day ? dayMessages : email ? emailMessages : recall ? recallMessages : calendarQuery ? calendarQueryMessages : weather ? weatherMessages : stock ? stockMessages : score ? scoreMessages : scores ? scoresMessages : verdict ? verdictMessages : digest ? digestMessages : []} />
  </AppShell>;
}
