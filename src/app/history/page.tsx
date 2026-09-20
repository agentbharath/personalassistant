import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { HistoryList } from "@/components/history/HistoryList";
import { isPerchEnabled } from "@/lib/replies/dismissals";
import { listConversations } from "@/lib/conversations/store";
import { signOut } from "../auth/actions";
import styles from "./history.module.css";

const PAGE = 30;

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : "Google connected";
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : undefined;
  const perchEnabled = await isPerchEnabled(userId);
  const rows = userId ? await listConversations(userId, { limit: PAGE + 1 }).catch(() => []) : [];

  return <AppShell title="History" email={email} signOutAction={signOut} recent={rows.slice(0, 40)} activeView="history" perchEnabled={perchEnabled}>
    <div className={styles.page}>
      <p className={styles.eyebrow}>Conversations</p>
      <h1 className={styles.title}>Your history</h1>
      <p className={styles.lede}>Only you can read these. They’re encrypted before they’re stored.</p>
      <HistoryList initial={rows.slice(0, PAGE)} initialHasMore={rows.length > PAGE} />
    </div>
  </AppShell>;
}
