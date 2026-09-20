"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationSummary } from "@/lib/conversations/store";
import { EditIcon, PinIcon, TrashIcon } from "@/components/ui/icons";
import { Menu } from "@/components/ui/Menu";
import { useConversationDeletion } from "./ConversationDeletion";
import styles from "./ConversationMenu.module.css";

/** Pin, rename and delete for one conversation. Used by the sidebar and the history page. */
export function ConversationMenu({ conversation, active, className }: { conversation: ConversationSummary; active: boolean; className?: string }) {
  const { requestDeletion, startRename, setPinned } = useConversationDeletion();
  return <Menu className={className} dataDeleteFor={conversation.id} label={`Actions for ${conversation.title}`} items={[
    { label: conversation.pinned ? "Unpin" : "Pin to top", icon: <PinIcon />, onSelect: () => void setPinned(conversation.id, !conversation.pinned) },
    { label: "Rename", icon: <EditIcon />, onSelect: () => startRename(conversation.id) },
    { label: "Delete", icon: <TrashIcon />, onSelect: () => requestDeletion(conversation, active) },
  ]} />;
}

/** Inline rename: Enter or leaving the field saves, Escape cancels. Focus returns to the row's menu button. */
export function RenameField({ conversation }: { conversation: ConversationSummary }) {
  const { rename, stopRename } = useConversationDeletion();
  const [value, setValue] = useState(conversation.title);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);

  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    const title = value.trim();
    if (save && title && title !== conversation.title) void rename(conversation.id, title);
    stopRename();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-delete-for="${conversation.id}"]`)?.focus());
  }

  return <input ref={field} className={styles.field} value={value} maxLength={80} aria-label="Chat name"
    onChange={(event) => setValue(event.target.value)}
    onBlur={() => finish(true)}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    }} />;
}
