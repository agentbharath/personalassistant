"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ConversationSummary } from "@/lib/conversations/store";
import { IconButton } from "@/components/ui/Button";
import { MenuIcon, SidebarIcon } from "@/components/ui/icons";
import { AccountMenu } from "./AccountMenu";
import styles from "./AppShell.module.css";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

type Props = {
  title: string;
  email: string;
  signOutAction: () => void | Promise<void>;
  recent: ConversationSummary[];
  activeConversationId?: string;
  activeView?: "chat" | "history" | "settings";
  children: ReactNode;
};

export function AppShell({ title, email, signOutAction, recent, activeConversationId, activeView = "chat", children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // The desktop sidebar can be hidden to give the chat the full width; the choice is remembered.
  useEffect(() => { try { setCollapsed(localStorage.getItem("daylark-sidebar") === "closed"); } catch { /* not remembered */ } }, []);
  const toggleSidebar = useCallback(() => setCollapsed((current) => { const next = !current; try { localStorage.setItem("daylark-sidebar", next ? "closed" : "open"); } catch { /* not remembered */ } return next; }), []);
  const close = useCallback(() => setOpen(false), []);
  const menuRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Opening the drawer moves focus into it; closing returns focus to the button that opened it.
  useEffect(() => {
    if (open) document.querySelector<HTMLElement>("#sidebar a, #sidebar button")?.focus();
    else if (wasOpen.current) menuRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Below this width the sidebar is an off-screen drawer, so it must not be reachable by keyboard while closed.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 56rem)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Any navigation closes the mobile drawer.
  useEffect(() => { setOpen(false); }, [pathname, search]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") { event.preventDefault(); toggleSidebar(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); router.push("/"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toggleSidebar]);

  return <div className={`${styles.shell} ${open ? styles.open : ""} ${collapsed ? styles.collapsed : ""}`}>
    <div className={styles.sidebarWrap} id="sidebar" inert={(narrow ? !open : collapsed) || undefined}>
      <Sidebar activeConversationId={activeConversationId} activeView={activeView} recent={recent} onNavigate={close} onClose={close} />
    </div>
    <div className={styles.scrim} onClick={close} aria-hidden="true" />
    <div className={styles.workspace} inert={open || undefined}>
      <header className={styles.topbar}>
        <IconButton className={styles.sidebarToggle} label={collapsed ? "Show sidebar" : "Hide sidebar"} aria-expanded={!collapsed} aria-controls="sidebar" onClick={toggleSidebar}><SidebarIcon /></IconButton>
        <IconButton ref={menuRef} className={styles.menuButton} label="Open menu" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(true)}><MenuIcon /></IconButton>
        <p className={styles.title} title={title}><span className={styles.crumb}>Daylark / </span>{title}</p>
        <ThemeToggle />
        <AccountMenu email={email} signOutAction={signOutAction} />
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
