"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./ShortcutsDialog.module.css";

const SHORTCUTS: Array<[string, string]> = [
  ["⌘K / Ctrl+K", "Start a new chat"],
  ["⌘B / Ctrl+B", "Hide or show the sidebar"],
  ["/", "Jump to the message box"],
  ["↑ in an empty box", "Bring back your last message"],
  ["Enter", "Send"],
  ["Shift+Enter", "New line"],
  ["Esc", "Close a menu, dialog or the find bar"],
  ["?", "Show this list"],
];

/** Modal with a focus trap; focus returns to whatever opened it. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null));

  useEffect(() => {
    closeRef.current?.focus();
    const previous = opener.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); } // the only control is Close
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); requestAnimationFrame(() => previous?.focus?.()); };
  }, [onClose]);

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <h2 id="shortcuts-title" className={styles.title}>Keyboard shortcuts</h2>
      <dl className={styles.list}>{SHORTCUTS.map(([keys, what]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>)}</dl>
      <div className={styles.actions}><Button ref={closeRef} variant="primary" onClick={onClose}>Close</Button></div>
    </section>
  </div>;
}
