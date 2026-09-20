"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationSummary } from "@/lib/conversations/store";
import { IconButton } from "@/components/ui/Button";
import { CalendarIcon, CloseIcon, ClockIcon, PinIcon, PlusIcon, SettingsIcon } from "@/components/ui/icons";
import { Wordmark } from "@/components/ui/Logo";
import { useConversationDeletion } from "./ConversationDeletion";
import { ConversationMenu, RenameField } from "./ConversationMenu";
import styles from "./Sidebar.module.css";

export type SidebarProps = {
  activeConversationId?: string;
  activeView?: "chat" | "today" | "history" | "settings";
  recent: ConversationSummary[];
  /** Called after any navigation, so the mobile drawer can close. */
  onNavigate?: () => void;
  /** Shown only inside the mobile drawer. */
  onClose?: () => void;
};

export function Sidebar({ activeConversationId, activeView = "chat", recent, onNavigate, onClose }: SidebarProps) {
  const { hiddenConversationIds, applyChanges, renamingId } = useConversationDeletion();
  const listRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(8);

  // Show as many of the latest chats as fit the space, so the list never scrolls. History has the rest.
  useEffect(() => {
    const box = listRef.current;
    if (!box) return;
    const measure = () => {
      const row = box.querySelector<HTMLElement>("[data-row]")?.offsetHeight || 32;
      const label = box.querySelector<HTMLElement>("h2")?.offsetHeight ?? 24;
      const rows = Math.floor((box.clientHeight - label) / row);
      setFit(Number.isFinite(rows) ? Math.max(3, rows) : 8);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const shown = useMemo(() => applyChanges(recent.filter((conversation) => !hiddenConversationIds.has(conversation.id))).slice(0, fit), [recent, hiddenConversationIds, fit, applyChanges]);

  return <nav className={styles.sidebar} aria-label="Conversations">
    <div className={styles.brand}>
      <Link href="/" onClick={onNavigate} aria-label="Daylark home"><Wordmark /></Link>
      {onClose && <IconButton className={styles.closeDrawer} label="Close menu" size="sm" onClick={onClose}><CloseIcon /></IconButton>}
    </div>
    <Link className={styles.newChat} href="/" onClick={onNavigate}><PlusIcon />New chat<kbd className={styles.kbd}>⌘K</kbd></Link>
    <div className={styles.scroll} ref={listRef}>
      {shown.length === 0
        ? <p className={styles.empty}>Your recent chats will appear here.</p>
        : <section className={styles.group} aria-label="Recent chats">
          <h2 className={styles.groupLabel} style={{ fontFamily: "var(--font-sans)", letterSpacing: "0.04em" }}>Recent</h2>
          {shown.map((conversation) => {
            const active = activeConversationId === conversation.id;
            return <div data-row className={`${styles.item} ${active ? styles.active : ""}`} key={conversation.id}>
              {renamingId === conversation.id
                ? <RenameField conversation={conversation} />
                : <>
                  <Link className={styles.link} href={{ pathname: "/", query: { conversation: conversation.id } }} title={conversation.title} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                    {conversation.pinned && <PinIcon className={styles.pin} width={12} height={12} aria-label="Pinned" role="img" />}<span className={styles.title}>{conversation.title}</span>
                  </Link>
                  <ConversationMenu className={styles.delete} conversation={conversation} active={active} />
                </>}
            </div>;
          })}
        </section>}
    </div>
    <div className={styles.foot}>
      <Link className={`${styles.all} ${activeView === "today" ? styles.allActive : ""}`} href={{ pathname: "/today" }} onClick={onNavigate}><CalendarIcon width={16} height={16} />Today</Link>
      <Link className={`${styles.all} ${activeView === "history" ? styles.allActive : ""}`} href={{ pathname: "/history" }} onClick={onNavigate}><ClockIcon width={16} height={16} />All history</Link>
      <Link className={`${styles.all} ${activeView === "settings" ? styles.allActive : ""}`} href={{ pathname: "/settings" }} onClick={onNavigate}><SettingsIcon width={16} height={16} />Settings</Link>
      <p className={styles.note}>Private by design. Anything that changes your data needs your approval.</p>
    </div>
  </nav>;
}
