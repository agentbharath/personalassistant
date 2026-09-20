import Link from "next/link";
import { MailIcon } from "@/components/ui/icons";
import { dismissReply } from "@/app/perch/actions";
import { displayName, type WaitingResult } from "@/lib/replies/waiting";
import styles from "./WaitingCard.module.css";
import card from "./TodayView.module.css";

function waited(receivedAt: number, now: number) {
  const days = Math.floor((now - receivedAt) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

const MAX_SHOWN = 8;

/** "Waiting on your reply": mail in Primary or Updates that seems to need an answer. Read-only; Dismiss only hides it here. */
export function WaitingCard({ result, now = Date.now(), dismiss = dismissReply }: { result: WaitingResult; now?: number; dismiss?: (formData: FormData) => Promise<void> }) {
  const shown = result.state === "ok" ? result.items.slice(0, MAX_SHOWN) : [];
  const more = result.state === "ok" ? result.items.length - shown.length : 0;
  return <section className={card.card} aria-label="Waiting on your reply">
    <header className={card.head}>
      <span className={`${card.chip} ${card.violet}`}><MailIcon /></span>
      <h2 className={card.cardTitle}>Waiting on your reply</h2>
      {result.state === "ok" && <span className={card.badge}>{result.items.length ? `${result.items.length} waiting` : "All caught up"}</span>}
    </header>
    {result.state === "needs_connection" && <div className={card.empty}><p>Connect Google to see mail that needs a reply.</p><Link className={card.action} href="/settings">Open Settings</Link></div>}
    {result.state === "unavailable" && <div className={card.empty}><p>I couldn’t check your mail just now. Nothing was changed.</p></div>}
    {result.state === "ok" && !shown.length && <p className={card.allClear}>Nothing in Primary or Updates looks like it needs a reply from the last 14 days.</p>}
    {shown.length > 0 && <ul className={card.list}>{shown.map((item) => <li className={styles.item} key={item.threadId}>
      <div className={styles.main}>
        <p className={styles.top}><strong>{displayName(item.from)}</strong><span className={card.sub}>waiting {waited(item.receivedAt, now)}</span></p>
        <p className={styles.subject}>{item.subject}</p>
        <p className={card.sub}>{item.reason}</p>
      </div>
      <div className={styles.actions}>
        <a className={styles.link} href={`https://mail.google.com/mail/u/0/#inbox/${item.threadId}`} target="_blank" rel="noopener noreferrer">Open<span className={styles.sr}> {item.subject} in Gmail</span></a>
        <form action={dismiss}><input type="hidden" name="thread" value={item.threadId} /><button className={styles.dismiss} type="submit">Dismiss<span className={styles.sr}> {item.subject}</span></button></form>
      </div>
    </li>)}</ul>}
    {more > 0 && <p className={card.sub} style={{ marginTop: "var(--s-3)" }}>+{more} more waiting.</p>}
    {result.state === "ok" && result.pending > 0 && <p className={card.sub} style={{ marginTop: "var(--s-3)" }}>Still checking {result.pending} recent message{result.pending === 1 ? "" : "s"}. Refresh in a moment for the rest.</p>}
  </section>;
}
