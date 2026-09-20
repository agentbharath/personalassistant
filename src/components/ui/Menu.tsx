"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./Button";
import { MoreIcon } from "./icons";
import styles from "./Menu.module.css";

export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void };

/**
 * A button that opens a menu of actions. Keyboard: Enter/Space/ArrowDown opens, arrows move, Home/End jump,
 * Escape closes and returns focus to the button, Tab closes. The panel is fixed-positioned so scrolling or clipped
 * parents (like the sidebar list) never cut it off.
 */
export function Menu({ label, items, className, dataDeleteFor }: { label: string; items: MenuItem[]; className?: string; dataDeleteFor?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  function show() {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  }
  function close(returnFocus = true) { setOpen(false); if (returnFocus) trigger.current?.focus(); }

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const dismiss = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss); };
  }, [open]);

  function onPanelKeyDown(event: React.KeyboardEvent) {
    const entries = Array.from(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const go = (next: number) => { event.preventDefault(); entries[(next + entries.length) % entries.length]?.focus(); };
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(entries.length - 1);
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === "Tab") close(false);
  }

  return <>
    <IconButton ref={trigger} className={className} size="sm" label={label} aria-haspopup="menu" aria-expanded={open} data-delete-for={dataDeleteFor}
      onClick={() => (open ? close(false) : show())}
      onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); show(); } }}><MoreIcon /></IconButton>
    {open && <div ref={panel} className={styles.panel} role="menu" aria-label={label} style={{ top: position.top, right: position.right }} onKeyDown={onPanelKeyDown}>
      {items.map((item) => <button key={item.label} type="button" role="menuitem" className={`${styles.item} ${item.danger ? styles.danger : ""}`} onClick={() => { setOpen(false); trigger.current?.focus(); item.onSelect(); }}>{item.icon}{item.label}</button>)}
    </div>}
  </>;
}
