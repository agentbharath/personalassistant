import { notFound } from "next/navigation";
import { Chat } from "@/components/chat/Chat";
import { AppShell } from "@/components/layout/AppShell";
import { signOut } from "@/app/auth/actions";
import { MOCK_RECENT, MOCK_THREAD } from "../mock";

/** Development-only signed-in view with mock data, so the chat can be screenshotted and accessibility-checked without a real account. */
export default async function DesignAppPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const view = (await searchParams).view;
  const thread = view === "thread";
  const scan = view === "scan";
  const scanMessages = [
    { role: "user" as const, content: "Import my spending from the last 30 days" },
    { role: "assistant" as const, status: "waiting_for_user", content: "### Review 2 imports\n\n1. **iHerb** — $35.53 · Sep 16\n2. **Discover** — $250.00 · Sep 11 · card payment\n\n500 email summaries checked. **Scan paused** in Primary and Updates. Progress is saved for 7 days. 62 known emails remain; more pages may follow. Choose **Continue scan** to resume where this scan stopped. Continuing does not import anything.\n\nChoose **Confirm** to import the reviewed items or **Cancel**." },
  ];
  return <AppShell title={thread ? "iHerb receipts" : "New conversation"} email="you@example.com" signOutAction={signOut} recent={MOCK_RECENT} activeConversationId={thread ? MOCK_RECENT[0].id : undefined}>
    <Chat key={view ?? "empty"} title={thread ? "iHerb receipts" : undefined} conversationId={thread ? MOCK_RECENT[0].id : undefined} initialMessages={scan ? scanMessages : thread ? MOCK_THREAD : []} />
  </AppShell>;
}
