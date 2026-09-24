import { loadWaitingReplies, type WaitingResult } from "@/lib/replies/waiting";
import { MailIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { WaitingCard } from "./WaitingCard";
import card from "./TodayView.module.css";

/** Loads on its own behind a Suspense boundary, so judging mail never delays the rest of the page. */
export async function RepliesSection({ userId, result }: { userId: string; result?: Promise<WaitingResult> }) {
  return <WaitingCard result={await (result ?? loadWaitingReplies(userId))} />;
}

/** Shown while mail is checked: the real card's header, a plain sentence saying what is happening, and placeholder rows. */
export function RepliesSkeleton() {
  return <section className={card.card} aria-label="Waiting on your reply" aria-busy="true">
    <header className={card.head}>
      <span className={`${card.chip} ${card.violet}`}><MailIcon /></span>
      <h2 className={card.cardTitle}>Waiting on your reply</h2>
    </header>
    <p className={card.sub} role="status" style={{ marginBottom: "var(--s-3)" }}>Checking your mail…</p>
    <div style={{ display: "grid", gap: "var(--s-3)" }}><Skeleton height="2.5rem" /><Skeleton height="2.5rem" /></div>
  </section>;
}
