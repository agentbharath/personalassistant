import { createClient } from "@/lib/supabase/server";
import { Chat } from "@/components/chat/Chat";
import { AppShell } from "@/components/layout/AppShell";
import { isPerchEnabled } from "@/lib/replies/dismissals";
import { getConversation, listConversations } from "@/lib/conversations/store";
import { signOut } from "../auth/actions";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : "Google connected";
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : undefined;
  if (!userId) console.error("home_no_user_claims", { hasClaims: Boolean(data?.claims), claimKeys: Object.keys(data?.claims ?? {}) });
  const requestedConversationId = (await searchParams).conversation;
  const [conversation, recent] = userId ? await Promise.all([
    requestedConversationId ? getConversation(userId, requestedConversationId).catch(() => null) : Promise.resolve(null),
    listConversations(userId, { limit: 40 }).catch((error) => { console.error("home_list_conversations_failed", error); return []; }),
  ]) : [null, []];

  const perchEnabled = await isPerchEnabled(userId);
  return <AppShell perchEnabled={perchEnabled} title={conversation?.title ?? "New conversation"} email={email} signOutAction={signOut} recent={recent} activeConversationId={conversation?.id}>
    <Chat key={conversation?.id ?? "new-conversation"} title={conversation?.title} conversationId={conversation?.id} initialMessages={conversation?.messages} initialHasMore={conversation?.hasMore} initialOldestSequence={conversation?.oldestSequence} />
  </AppShell>;
}
