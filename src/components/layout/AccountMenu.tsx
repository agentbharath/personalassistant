"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Avatar } from "@/components/ui/Avatar";
import styles from "./AccountMenu.module.css";

export function AccountMenu({ email, signOutAction }: { email: string; signOutAction: () => void | Promise<void> }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (event: Event) => { if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && ref.current?.open) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);

  return <details className={styles.menu} ref={ref}>
    <summary className={styles.trigger} aria-label="Account menu"><Avatar name={email} /></summary>
    <div className={styles.panel}>
      <div className={styles.who}><p className={styles.label}>Signed in as</p><p className={styles.email} title={email}>{email}</p></div>
      <Link className={styles.item} href={{ pathname: "/settings" }}>Settings</Link>
      <form action={signOutAction}><button className={styles.item} type="submit">Sign out</button></form>
    </div>
  </details>;
}
