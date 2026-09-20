import type { ReactNode } from "react";
import styles from "./StatusPage.module.css";

/** The frame for "something went wrong" and "page not found": a short heading, one sentence, and the ways out. */
export function StatusPage({ code, title, children, actions }: { code?: string; title: string; children: ReactNode; actions: ReactNode }) {
  return <main id="main" className={styles.page}>
    <div className={styles.card}>
      {code && <p className={styles.code}>{code}</p>}
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.copy}>{children}</p>
      <div className={styles.actions}>{actions}</div>
    </div>
  </main>;
}
