import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { CheckIcon, MailIcon } from "@/components/ui/icons";
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
  const hiddenItems = result.state === "ok" ? result.items.filter((item) => !result.prefs.kinds.includes(item.kind)) : [];
  const hiddenKinds = REPLY_KINDS.filter((kind) => hiddenItems.some((item) => item.kind === kind)).map((kind) => KIND_LABELS[kind].title);
  const unchecked = result.state === "ok" ? result.total - result.checked : 0;
  const shown = visible.slice(0, MAX_SHOWN);
  const more = visible.length - shown.length;
  return <section className={card.card} aria-label="Waiting on your reply">
    <header className={card.head}>
      <span className={`${card.chip} ${card.violet}`}><MailIcon /></span>
      <h2 className={card.cardTitle}>Waiting on your reply</h2>
      {result.state === "ok" && <span className={card.badge}>{visible.length ? `${visible.length} waiting` : "All caught up"}</span>}
    </header>

    {result.state === "setup" && <ActionForm action={save} success="Saved. I’ll start checking your mail." className={styles.setup}>
      <p className={card.note}>I can remind you about mail that’s waiting for your reply. It only looks at your Primary and Updates tabs, and it never changes your email. What should I remind you about?</p>
      <div className={styles.chooseForm}><KindOptions selected={result.prefs.kinds} /></div>
      <div className={styles.buttons}>
        <button className={styles.primary} type="submit" name="scope" value="setup-on">Remind me about these</button>
        <button className={styles.save} type="submit" name="scope" value="setup-off">No reminders</button>
      </div>
      <p className={card.sub}>You can change this any time in Settings.</p>
    </ActionForm>}

    {result.state === "needs_connection" && <div className={card.empty}><p>Connect Google to see mail that needs a reply.</p><Link className={card.action} href="/settings">Open Settings</Link></div>}
    {result.state === "unavailable" && <div className={card.empty}><p>I couldn’t check your mail just now. Nothing was changed.</p></div>}
    {result.state === "ok" && !shown.length && (unchecked > 0
      ? <p className={card.quiet}>Nothing so far. I’ve checked {result.checked} of your {result.total} recent messages.</p>
      : <p className={card.allClear}><CheckIcon />You’re all caught up. Nothing from the last 7 days looks like it needs a reply.</p>)}
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
    {hiddenItems.length > 0 && <p className={card.sub} style={{ marginTop: "var(--s-3)" }}>{hiddenItems.length} more {hiddenItems.length === 1 ? "needs" : "need"} a reply but {hiddenItems.length === 1 ? "is" : "are"} hidden by your choices ({hiddenKinds.join(", ")}). You can change that below.</p>}
    {more > 0 && <p className={card.sub} style={{ marginTop: "var(--s-3)" }}>+{more} more waiting.</p>}
    {unchecked > 0 && <p className={card.sub} style={{ marginTop: "var(--s-3)" }}>Checked {result.state === "ok" ? result.checked : 0} of {result.state === "ok" ? result.total : 0} recent messages so far. Refresh to check the rest.</p>}

    {result.state === "ok" && <details className={styles.choose}>
      <summary className={styles.chooseSummary}>What should I remind you about?</summary>
      <ActionForm action={save} success="Saved." className={styles.chooseForm}>
        <input type="hidden" name="scope" value="kinds" />
        <KindOptions selected={result.prefs.kinds} />
        <button className={styles.save} type="submit">Save choices</button>
      </ActionForm>
    </details>}
  </section>;
}
