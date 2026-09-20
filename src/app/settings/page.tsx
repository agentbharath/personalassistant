import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { ThemePicker } from "@/components/settings/ThemePicker";
import { LocationField } from "@/components/settings/LocationField";
import { DataControls } from "@/components/settings/DataControls";
import { ForgetAll, ForgetButton } from "@/components/settings/ForgetButton";
import { listConversations } from "@/lib/conversations/store";
import { describeLearning } from "@/lib/learning/commands";
import { learningKey, listLearnings } from "@/lib/learning/store";
import { PerchSettings } from "@/components/settings/PerchSettings";
import { NO_PERCH_PREFS, loadPerchPrefs } from "@/lib/replies/dismissals";
import { SettingsLegalLinks } from "@/components/legal/LegalLinks";
import { signOut } from "../auth/actions";
import { ConnectionsFallback, ConnectionsSection } from "./ConnectionsSection";
import { CalendarIcon, EditIcon, LocateIcon, MailIcon, SettingsIcon, SunIcon, WalletIcon } from "@/components/ui/icons";
import { SettingsGroup, SettingsSection } from "./SettingsSection";
import styles from "./settings.module.css";


export default async function SettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : "Google connected";
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : undefined;
  const [allLearnings, recent, perch] = userId ? await Promise.all([listLearnings(userId), listConversations(userId, { limit: 40 }).catch(() => []), loadPerchPrefs(userId).catch(() => NO_PERCH_PREFS)]) : [[], [], NO_PERCH_PREFS];

  // The home location has its own section above, so it is not repeated in the list of things learned from corrections.
  const home = allLearnings.flatMap((learning) => (learning.kind === "home_location" ? [learning.place] : []))[0] ?? "";
  const learnings = allLearnings.filter((learning) => learning.kind !== "home_location");

  return <AppShell title="Settings" email={email} signOutAction={signOut} recent={recent} activeView="settings" perchEnabled={perch.perchEnabled}>
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>

      <SettingsGroup label="Google">
        <SettingsSection id="connections" title="Connections" help="What Daylark can reach in your Google account." icon={<MailIcon />} tone="green">
          <Suspense fallback={<ConnectionsFallback />}><ConnectionsSection userId={userId} /></Suspense>
        </SettingsSection>
      </SettingsGroup>

      <SettingsGroup label="Preferences">
        <SettingsSection id="perch" title="Perch and reminders" help="Perch is your day at a glance. Reminders list mail in Primary and Updates that seems to be waiting for your reply. Turn either off any time." icon={<CalendarIcon />} tone="violet">
          <PerchSettings prefs={perch} />
        </SettingsSection>
        <SettingsSection id="location" title="Location" help="Used as your starting point for drive times and to look for places near you. It is sent to Google Maps and the search provider only when a request needs it. Anything you name in a message takes priority." icon={<LocateIcon />} tone="blue">
          <LocationField initial={home} />
        </SettingsSection>
        <SettingsSection id="appearance" title="Appearance" help="Choose how Daylark looks. “System” follows your device." icon={<SunIcon />} tone="amber">
          <ThemePicker />
        </SettingsSection>
      </SettingsGroup>

      <SettingsGroup label="Memory">
        <SettingsSection id="learned" title="What Daylark has learned" help="Preferences picked up when you correct me. Forget any of them and I go back to the default." icon={<EditIcon />} tone="neutral" focusable>
          {learnings.length === 0
            ? <p className={styles.empty}>Nothing yet. I learn when you say things like “I meant Adobe” or “always search 90 days”.</p>
            : <ul className={styles.list}>{learnings.map((learning) => {
              const id = `${learning.kind}:${learningKey(learning)}`;
              return <li key={id} className={styles.row}>
                <span>{describeLearning(learning)}</span>
                <ForgetButton id={id} what={describeLearning(learning)} />
              </li>;
            })}</ul>}
          {learnings.length > 1 && <ForgetAll />}
        </SettingsSection>
      </SettingsGroup>

      <SettingsGroup label="Data and account">
        <SettingsSection id="data" title="Your data" help="Take a copy, or remove what Daylark keeps about you." icon={<WalletIcon />} tone="neutral">
          <DataControls />
        </SettingsSection>
        <SettingsSection id="account" title="Account" help={`Signed in as ${email}. Email access is read-only, and anything that changes your calendar or records asks for your approval first.`} icon={<SettingsIcon />} tone="neutral">
          <SettingsLegalLinks />
        </SettingsSection>
      </SettingsGroup>
    </div>
  </AppShell>;
}
