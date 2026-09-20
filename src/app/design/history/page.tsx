import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { HistoryList } from "@/components/history/HistoryList";
import { signOut } from "@/app/auth/actions";
import { MOCK_RECENT } from "../mock";
import styles from "@/app/history/history.module.css";

/** Development-only History view with mock data. */
export default function DesignHistoryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AppShell title="History" email="you@example.com" signOutAction={signOut} recent={MOCK_RECENT} activeView="history">
    <div className={styles.page}>
      <p className={styles.eyebrow}>Conversations</p>
      <h1 className={styles.title}>Your history</h1>
      <p className={styles.lede}>Only you can read these. They’re encrypted before they’re stored.</p>
      <HistoryList initial={MOCK_RECENT} initialHasMore={false} />
    </div>
  </AppShell>;
}
