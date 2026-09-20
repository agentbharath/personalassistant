import Link from "next/link";
import { MailIcon } from "@/components/ui/icons";
import { dismissReply, savePerchChoices } from "@/app/perch/actions";
import { REPLY_KINDS, type ReplyKind } from "@/lib/agents/reply-needed";
import { displayName, type WaitingResult } from "@/lib/replies/waiting";
import { KIND_LABELS } from "./reply-kinds";
import styles from "./WaitingCard.module.css";
import card from "./TodayView.module.css";

function waited(receivedAt: number, now: number) {
  const days = Math.floor((now - receivedAt) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

const MAX_SHOWN = 8;
type Action = (formData: FormData) => Promise<void>;

function KindOptions({ selected }: { selected: ReplyKind[] }) {
  return <>{REPLY_KINDS.map((kind) => <label className={styles.option} key={kind}>
    <input type="checkbox" name="kind" value={kind} defaultChecked={selected.includes(kind)} />
    <span><span className={styles.optionTitle}>{KIND_LABELS[kind].title}</span><span className={card.sub}>{KIND_LABELS[kind].hint}</span></span>
  </label>)}</>;
}

/**
 * "Waiting on your reply": mail in Primary or Updates that seems to need an answer. Read-only; Dismiss only hides it here.
 * Reminders are opt-in: until the owner answers the first-visit question, nothing is read and the card only asks.
 */
export function WaitingCard({ result, now = Date.now(), dismiss = dismissReply, save = savePerchChoices }: { result: WaitingResult; now?: number; dismiss?: Action; save?: Action }) {
  if (result.state === "off") return null;
  const visible = result.state === "ok" ? result.items.filter((item) => result.prefs.kinds.includes(item.kind)) : [];
  const hidden = result.state === "ok" ? result.items.length - visible.length : 0;
  const shown = visible.slice(0, MAX_SHOWN);
  const more = visible.length - shown.length;
  return <section className={card.card} aria-label="Waiting on your reply">
    <header className={card.head}>
      <span className={`${card.chip} ${card.violet}`}><MailIcon /></span>
      <h2 className={card.cardTitle}>Waiting on your reply</h2>
      {result.state === "ok" && <span className={card.badge}>{visible.length ? `${visible.length} waiting` : "All caught up"}</span>}
    </header>

    {result.state === "setup" && <form action={save} className={styles.setup}>
      <p className={card.note}>I can remind you about mail that’s waiting for your reply. It only looks at your Primary and Updates tabs, and it never changes your email. What should I remind you about?</p>
      <div className={styles.chooseForm}><KindOptions selected={result.prefs.kinds} /></div>
      <div className={styles.buttons}>
        <button className={styles.primary} type="submit" name="scope" value="setup-on">Remind me about these</button>
        <button className={styles.save} type="submit" name="scope" value="setup-off">No reminders</button>
      </div>
      <p className={card.sub}>You can change this any time in Settings.</p>
    </form>}

    {result.state === "needs_connection" && <div className={card.empty}><p>Connect Google to see mail that needs a reply.</p><Link className={card.action} href="/settings">Open Settings</Link></div>}
    {result.state === "unavailable" && <div className={card.empty}><p>I couldn’t check your mail just now. Nothing was changed.</p></div>}
    {result.state === "ok" && !shown.length && <p className={card.allClear}>Nothing you asked about looks like it needs a reply from the last 14 days.</p>}
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
    {hidden > 0 && <p className={card.sub} style={{ marginTop: "var(--s-3)" }}>{hidden} more {hidden === 1 ? "is" : "are"} hidden by what you chose to see.</p>}
    {more > 0 && <p className={card.sub} style={{ marginTop: "var(--s-3)" }}>+{more} more waiting.</p>}
    {result.state === "ok" && result.pending > 0 && <p className={card.sub} style={{ marginTop: "var(--s-3)" }}>Still checking {result.pending} recent message{result.pending === 1 ? "" : "s"}. Refresh in a moment for the rest.</p>}

    {result.state === "ok" && <details className={styles.choose}>
      <summary className={styles.chooseSummary}>What should I remind you about?</summary>
      <form action={save} className={styles.chooseForm}>
        <input type="hidden" name="scope" value="kinds" />
        <KindOptions selected={result.prefs.kinds} />
        <button className={styles.save} type="submit">Save choices</button>
      </form>
    </details>}
  </section>;
}
