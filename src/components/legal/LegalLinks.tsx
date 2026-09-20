"use client";

import { LegalDialogs } from "./LegalDialog";
import styles from "./LegalLinks.module.css";

/** The sentence under the sign-in button. */
export function SignInLegalNotice() {
  return <LegalDialogs>{(open) => <p className={styles.notice}>By continuing you agree to the <button type="button" className={styles.link} onClick={() => open("terms")}>Terms of Service</button> and acknowledge the <button type="button" className={styles.link} onClick={() => open("privacy")}>Privacy Policy</button>.</p>}</LegalDialogs>;
}

/** The two links in Settings. */
export function SettingsLegalLinks() {
  return <LegalDialogs>{(open) => <p className={styles.settings}><button type="button" className={styles.link} onClick={() => open("privacy")}>Privacy Policy</button> · <button type="button" className={styles.link} onClick={() => open("terms")}>Terms of Service</button></p>}</LegalDialogs>;
}
