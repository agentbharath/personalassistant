import type { ReactNode } from "react";
import styles from "./settings.module.css";

export type Tone = "blue" | "green" | "amber" | "violet" | "neutral";

/** One settings section as a card: a tinted icon, a title, a line of help, then the controls. The id lets other pages link straight to a section (for example, what Daylark has learned). */
export function SettingsSection({ id, title, help, icon, tone = "neutral", focusable = false, children }: { id: string; title: string; help: ReactNode; icon: ReactNode; tone?: Tone; focusable?: boolean; children: ReactNode }) {
  return <section className={styles.card} aria-labelledby={id}>
    <header className={styles.head}>
      <span className={`${styles.chip} ${tone === "neutral" ? styles.plain : styles[tone]}`}>{icon}</span>
      <div className={styles.headText}>
        <h2 id={id} className={styles.cardTitle} tabIndex={focusable ? -1 : undefined} data-focusable={focusable || undefined}>{title}</h2>
        <p className={styles.help}>{help}</p>
      </div>
    </header>
    <div className={styles.body}>{children}</div>
  </section>;
}

/** A labelled group of cards, so a long page reads as a few parts instead of one stack. */
export function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.group} role="group" aria-label={label}>
    <p className={styles.groupLabel} aria-hidden="true">{label}</p>
    {children}
  </div>;
}
