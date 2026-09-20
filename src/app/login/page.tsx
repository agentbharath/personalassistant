import { SignInLegalNotice } from "@/components/legal/LegalLinks";
import { LoginButton } from "@/components/login/LoginButton";
import { Wordmark } from "@/components/ui/Logo";
import { safeNextPath } from "@/lib/auth/next-path";
import styles from "./login.module.css";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  return <main id="main" className={styles.page}>
    <section className={styles.story}>
      <Wordmark />
      <div>
        <p className={styles.eyebrow}>Personal intelligence, quietly useful</p>
        <h1 className={styles.headline}>Your day, <em>in one conversation.</em></h1>
        <p className={styles.copy}>Calendar, email, plans and spending, understood together, with you in control.</p>
      </div>
      <figure className={styles.quote} aria-label="Example conversation">
        <p className={styles.ask}><span className={styles.typed}>Can dinner fit before my 7:30 meeting?</span></p>
        <div className={styles.thinking} aria-hidden="true"><i /><i /><i /></div>
        <p className={styles.reply}><strong>Yes, you have a 2h 10m window.</strong>Leave by 7:05 PM to arrive on time. Your calendar stays unchanged.</p>
      </figure>
      <p className={styles.foot}>Private by design · Anything that changes your data needs your approval</p>
    </section>
    <section className={styles.panel}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Sign in</p>
        <h2>Welcome back.</h2>
        <p className={styles.lede}>Connect Google to bring in your calendar and email context.</p>
        <LoginButton next={next} />
        <ul className={styles.checks} aria-label="What Daylark does with your data">
          <li>Email access is read-only</li>
          <li>Changes to your calendar or records need your approval</li>
          <li>Conversations are encrypted before they’re stored</li>
        </ul>
        <SignInLegalNotice />
      </div>
    </section>
  </main>;
}
