"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./Toast.module.css";

export type ToastInput = {
  message: string;
  /** A button on the toast, such as Undo. Choosing it dismisses the toast. */
  action?: { label: string; onAction: () => void };
  /** How long it stays. Default 6 seconds; pauses while the pointer is over it. */
  durationMs?: number;
  /** A line that drains as time runs out, for actions that expire (Undo). */
  showProgress?: boolean;
  /** Move keyboard focus to the action when it appears, for a result the user just caused. */
  focusAction?: boolean;
  tone?: "info" | "notice";
  /** Called when time runs out without the action being used. */
  onExpire?: () => void;
  /** Called whenever the toast goes away. `hadFocus` says keyboard focus was inside it, so the caller can put focus somewhere sensible. */
  onGone?: (reason: "action" | "expire" | "close", hadFocus: boolean) => void;
};

type Item = ToastInput & { id: number };
type Api = { toast: (input: ToastInput) => number; dismiss: (id: number) => void };

const ToastContext = createContext<Api | null>(null);

/** One notification system for the whole app: a polite live region at the bottom, one look, one set of keyboard rules. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const toast = useCallback((input: ToastInput) => { const id = nextId.current++; setItems((current) => [...current, { ...input, id }]); return id; }, []);
  /** Removes a toast without calling its callbacks, for when the caller has already handled the outcome. */
  const dismiss = useCallback((id: number) => remove(id), [remove]);

  return <ToastContext.Provider value={{ toast, dismiss }}>
    {children}
    <div className={styles.region} role="region" aria-label="Notifications" aria-live="polite">
      {items.map((item) => <ToastView key={item.id} item={item} onRemove={remove} />)}
    </div>
  </ToastContext.Provider>;
}

function ToastView({ item, onRemove }: { item: Item; onRemove: (id: number) => void }) {
  const duration = item.durationMs ?? 6_000;
  const root = useRef<HTMLDivElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(0);
  const remaining = useRef(duration);
  const [paused, setPaused] = useState(false);
  const finished = useRef(false);

  const finish = useCallback((reason: "action" | "expire" | "close") => {
    if (finished.current) return;
    finished.current = true;
    if (timer.current) clearTimeout(timer.current);
    const hadFocus = Boolean(root.current?.contains(document.activeElement));
    onRemove(item.id);
    if (reason === "expire") item.onExpire?.();
    item.onGone?.(reason, hadFocus);
  }, [item, onRemove]);

  const start = useCallback(() => {
    started.current = Date.now();
    timer.current = setTimeout(() => finish("expire"), remaining.current);
  }, [finish]);

  useEffect(() => { start(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [start]);
  useEffect(() => { if (item.focusAction) actionButton.current?.focus(); }, [item.focusAction]);

  function pause() { if (timer.current) { clearTimeout(timer.current); timer.current = null; remaining.current -= Date.now() - started.current; setPaused(true); } }
  function resume() { if (!timer.current && !finished.current) { setPaused(false); start(); } }

  return <div ref={root} className={`${styles.toast} ${item.tone === "notice" ? styles.notice : ""}`} onPointerEnter={pause} onPointerLeave={resume}>
    <span className={styles.message}>{item.message}</span>
    {item.action
      ? <button ref={actionButton} type="button" className={styles.button} onClick={() => { item.action?.onAction(); finish("action"); }}>{item.action.label}</button>
      : <button type="button" className={styles.button} onClick={() => finish("close")}>Dismiss</button>}
    {item.showProgress && <span className={styles.progress} aria-hidden="true" style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? "paused" : "running" }} />}
  </div>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
