"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";

type Props = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** When set, the confirm button stays disabled until the user types this exactly. For actions that cannot be undone. */
  requireText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A small confirmation modal. Focus starts on Cancel (the safe choice), Tab stays inside, Escape or clicking outside cancels,
 * and focus returns to whatever opened it.
 */
export function ConfirmDialog({ title, children, confirmLabel, requireText, busy, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState("");
  const matches = !requireText || typed.trim().toLowerCase() === requireText.toLowerCase();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null));

  useEffect(() => {
    cancelRef.current?.focus();
    const previous = opener.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!busy) onCancel(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); requestAnimationFrame(() => { if (previous?.isConnected) previous.focus(); }); };
  }, [busy, onCancel]);

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section ref={panel} className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-copy">
      <h2 id="confirm-title" className={styles.title}>{title}</h2>
      <div id="confirm-copy" className={styles.copy}>{children}</div>
      {requireText && <label className={styles.typed}>Type <strong>{requireText}</strong> to confirm<input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} onKeyDown={(event) => { if (event.key === "Enter" && matches && !busy) { event.preventDefault(); onConfirm(); } }} /></label>}
      <div className={styles.actions}>
        <Button ref={cancelRef} variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={busy || !matches} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</Button>
      </div>
    </section>
  </div>;
}
