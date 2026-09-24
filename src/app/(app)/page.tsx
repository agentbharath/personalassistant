import { createClient } from "@/lib/supabase/server";
import { Chat } from "@/components/chat/Chat";
import { AppShell } from "@/components/layout/AppShell";
import { isPerchEnabled } from "@/lib/replies/dismissals";
import { getConversation, listConversations } from "@/lib/conversations/store";
import { signOut } from "../auth/actions";
import { logEvent, reportFailure } from "@/lib/observability/report";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ conversation?: string; intent?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : "Google connected";
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : undefined;
  if (!userId) logEvent("error", "home_no_user_claims", { hasClaims: Boolean(data?.claims), claimKeys: Object.keys(data?.claims ?? {}).join(",") });
  const params = await searchParams;
  const requestedConversationId = params.conversation;
  const duesInput = params.intent === "dues" && !requestedConversationId ? "Show all my dues, including credit card and utility statements from email" : undefined;
  let conversationLoadFailed = false;
  const [conversation, recent] = userId ? await Promise.all([
    requestedConversationId ? getConversation(userId, requestedConversationId).catch((error) => { conversationLoadFailed = true; reportFailure("home_load_conversation_failed", error, {}, { userId }); return null; }) : Promise.resolve(null),
    listConversations(userId, { limit: 40 }).catch((error) => { reportFailure("home_list_conversations_failed", error, {}, { userId }); return []; }),
  ]) : [null, []];

  const perchEnabled = await isPerchEnabled(userId);
  return <AppShell perchEnabled={perchEnabled} title={conversation?.title ?? (requestedConversationId ? "Conversation unavailable" : "New conversation")} email={email} signOutAction={signOut} recent={recent} activeConversationId={conversation?.id ?? requestedConversationId}>
    {requestedConversationId && !conversation ? <section role="alert" style={{ padding: "2rem" }}>
      <h1>{conversationLoadFailed ? "This chat couldn’t load" : "This chat isn’t available"}</h1>
      <p>{conversationLoadFailed ? "There was a problem reading the saved conversation. Try loading it again." : "It may have been deleted, or belong to a different account. Choose another chat from the sidebar."}</p>
      <a href={`/?conversation=${encodeURIComponent(requestedConversationId)}`}>Try again</a>
    </section> : <Chat key={conversation?.id ?? (duesInput ? "new-dues" : "new-conversation")} initialInput={duesInput} title={conversation?.title} conversationId={conversation?.id} initialMessages={conversation?.messages} initialHasMore={conversation?.hasMore} initialOldestSequence={conversation?.oldestSequence} />}
  </AppShell>;
}
