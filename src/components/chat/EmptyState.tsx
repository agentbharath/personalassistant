"use client";

import { useEffect, useState } from "react";
import { CalendarIcon, MailIcon, SearchIcon, WalletIcon } from "@/components/ui/icons";
import { greeting } from "@/lib/ui/grouping";
import styles from "./EmptyState.module.css";

const STARTERS = [
  { Icon: CalendarIcon, tag: "Calendar", tone: "blue", title: "Plan around my day", text: "Can I catch a movie Saturday afternoon and be back before my meeting?" },
  { Icon: WalletIcon, tag: "Spending", tone: "green", title: "Where my money went", text: "How much have I spent so far, by category?" },
  { Icon: MailIcon, tag: "Inbox", tone: "amber", title: "Find receipts and mail", text: "Show my latest receipts with the amounts." },
  { Icon: SearchIcon, tag: "Across apps", tone: "violet", title: "Combine email and calendar", text: "Find the restaurant recommendation from last week and check if Friday evening is free." },
] as const;

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  // Set after mount: the server's clock and the viewer's clock differ, and a mismatch would break hydration.
  const [hello, setHello] = useState("Hello");
  useEffect(() => { setHello(greeting(new Date().getHours())); }, []);
  return <section className={styles.empty} aria-labelledby="empty-title">
    <h1 className={styles.title} id="empty-title">{hello}. <span>What’s on your mind?</span></h1>
    <div className={styles.starters}>
      {STARTERS.map(({ Icon, tag, tone, title, text }) => <button key={text} type="button" className={`${styles.starter} ${styles[tone]}`} onClick={() => onPick(text)}>
        <span className={styles.top}><span className={styles.icon}><Icon /></span><span className={styles.tag}>{tag}</span></span>
        <span className={styles.starterTitle}>{title}</span>
        <span className={styles.starterText}>“{text}”</span>
      </button>)}
    </div>
  </section>;
}
