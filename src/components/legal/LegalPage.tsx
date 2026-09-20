import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/ui/Logo";
import { legal, unsetLegalFields } from "@/lib/legal/config";
import styles from "./LegalPage.module.css";

/** Shared frame for the privacy policy and terms. These pages are public: Google's sign-in review needs to reach them without an account. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const unset = process.env.NODE_ENV === "production" ? [] : unsetLegalFields();
  return <div className={styles.page}>
    <header className={styles.top}>
      <Link href="/" aria-label={`${legal.product} home`}><Wordmark /></Link>
      <nav aria-label="Legal" className={styles.nav}>
        <Link href={{ pathname: "/privacy" }}>Privacy</Link>
        <Link href={{ pathname: "/terms" }}>Terms</Link>
      </nav>
    </header>
    <main id="main" tabIndex={-1} className={styles.main}>
      {unset.length > 0 && <p className={styles.warning} role="note">Development notice: set NEXT_PUBLIC_LEGAL_* values for {unset.join(", ")} before publishing.</p>}
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.meta}>Effective {legal.effective}</p>
      <div className={styles.body}>{children}</div>
    </main>
  </div>;
}
