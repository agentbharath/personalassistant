"use client";

import { useEffect, useRef } from "react";
import { IconButton } from "@/components/ui/Button";
import { ArrowDownIcon, CloseIcon } from "@/components/ui/icons";
import styles from "./FindBar.module.css";

type Props = { query: string; onQuery: (query: string) => void; count: number; position: number; onStep: (direction: 1 | -1) => void; onClose: () => void };

export function FindBar({ query, onQuery, count, position, onStep, onClose }: Props) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  return <div className={styles.bar} role="search" aria-label="Find in this chat">
    <input ref={field} type="search" className={styles.field} value={query} placeholder="Find in this chat" aria-label="Find in this chat"
      onChange={(event) => onQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); onStep(event.shiftKey ? -1 : 1); }
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
      }} />
    <span className={styles.count} role="status">{query.trim() ? (count ? `${position} of ${count}` : "No matches") : ""}</span>
    <IconButton size="sm" label="Previous match" disabled={!count} onClick={() => onStep(-1)}><ArrowDownIcon style={{ transform: "rotate(180deg)" }} /></IconButton>
    <IconButton size="sm" label="Next match" disabled={!count} onClick={() => onStep(1)}><ArrowDownIcon /></IconButton>
    <IconButton size="sm" label="Close find" onClick={onClose}><CloseIcon /></IconButton>
  </div>;
}
