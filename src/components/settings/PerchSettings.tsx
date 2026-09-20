import { savePerchChoices } from "@/app/perch/actions";
import { REPLY_KINDS } from "@/lib/agents/reply-needed";
import type { PerchPrefs } from "@/lib/replies/dismissals";
import { KIND_LABELS } from "@/components/today/reply-kinds";
import { ActionForm } from "@/components/ui/ActionForm";
import styles from "./PerchSettings.module.css";

/** Settings for Perch: show it or not, remind or not, and which kinds of waiting mail. Each is a plain checkbox that saves with one button. */
export function PerchSettings({ prefs, save = savePerchChoices }: { prefs: PerchPrefs; save?: (formData: FormData) => Promise<void> }) {
  return <ActionForm action={save} success="Saved." className={styles.form}>
    <input type="hidden" name="scope" value="settings" />
    <label className={styles.option}>
      <input type="checkbox" name="perch" defaultChecked={prefs.perchEnabled} />
      <span><span className={styles.title}>Show Perch</span><span className={styles.hint}>The page with your meetings, bills, spending and reminders. Off hides it from the menu.</span></span>
    </label>
    <label className={styles.option}>
      <input type="checkbox" name="reminders" defaultChecked={prefs.saved ? prefs.remindersEnabled : false} />
      <span><span className={styles.title}>Remind me about mail waiting for a reply</span><span className={styles.hint}>{prefs.saved ? "Only Primary and Updates, and Daylark never changes your email." : "Not chosen yet. Nothing is read until you turn this on."}</span></span>
    </label>
    <fieldset className={styles.kinds}>
      <legend className={styles.legend}>Remind me about</legend>
      {REPLY_KINDS.map((kind) => <label className={styles.option} key={kind}>
        <input type="checkbox" name="kind" value={kind} defaultChecked={prefs.kinds.includes(kind)} />
        <span><span className={styles.title}>{KIND_LABELS[kind].title}</span><span className={styles.hint}>{KIND_LABELS[kind].hint}</span></span>
      </label>)}
    </fieldset>
    <button className={styles.save} type="submit">Save</button>
  </ActionForm>;
}
