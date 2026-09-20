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
  return <AppShell title={thread ? "iHerb receipts" : "New conversation"} email="you@example.com" signOutAction={signOut} recent={MOCK_RECENT} activeConversationId={thread ? MOCK_RECENT[0].id : undefined}>
    <Chat key={view ?? "empty"} title={thread ? "iHerb receipts" : undefined} conversationId={thread ? MOCK_RECENT[0].id : undefined} initialMessages={thread ? MOCK_THREAD : []} />
  </AppShell>;
}
