import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { CalendarIcon, EditIcon, LocateIcon, MailIcon, SettingsIcon, SunIcon, WalletIcon } from "@/components/ui/icons";
import { DataControls } from "@/components/settings/DataControls";
import { LocationField } from "@/components/settings/LocationField";
import { PerchSettings } from "@/components/settings/PerchSettings";
import { ThemePicker } from "@/components/settings/ThemePicker";
import { SettingsLegalLinks } from "@/components/legal/LegalLinks";
import { signOut } from "@/app/auth/actions";
import { ConnectionsFallback } from "@/app/settings/ConnectionsSection";
import { SettingsGroup, SettingsSection } from "@/app/settings/SettingsSection";
import styles from "@/app/settings/settings.module.css";
import { MOCK_RECENT } from "../mock";

/** Development-only Settings view with mock data. It mirrors src/app/settings/page.tsx. */
export default function DesignSettingsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AppShell title="Settings" email="you@example.com" signOutAction={signOut} recent={MOCK_RECENT} activeView="settings">
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      <SettingsGroup label="Google">
        <SettingsSection id="connections" title="Connections" help="What Daylark can reach in your Google account." icon={<MailIcon />} tone="green"><ConnectionsFallback /></SettingsSection>
      </SettingsGroup>
      <SettingsGroup label="Preferences">
        <SettingsSection id="perch" title="Perch and reminders" help="Perch is your day at a glance. Reminders list mail in Primary and Updates that seems to be waiting for your reply. Turn either off any time." icon={<CalendarIcon />} tone="violet">
          <PerchSettings prefs={{ saved: true, perchEnabled: true, remindersEnabled: false, kinds: ["person", "business", "recruiter"] }} />
        </SettingsSection>
        <SettingsSection id="location" title="Location" help="Used as your starting point for drive times and to look for places near you. It is sent to Google Maps and the search provider only when a request needs it. Anything you name in a message takes priority." icon={<LocateIcon />} tone="blue"><LocationField initial="Mountain View, CA" /></SettingsSection>
        <SettingsSection id="appearance" title="Appearance" help="Choose how Daylark looks. “System” follows your device." icon={<SunIcon />} tone="amber"><ThemePicker /></SettingsSection>
      </SettingsGroup>
      <SettingsGroup label="Memory">
        <SettingsSection id="learned" title="What Daylark has learned" help="Preferences picked up when you correct me. Forget any of them and I go back to the default." icon={<EditIcon />}>
          <ul className={styles.list}><li className={styles.row}><span>Receipts show amounts by default</span></li><li className={styles.row}><span>“adobee” means Adobe</span></li></ul>
        </SettingsSection>
      </SettingsGroup>
      <SettingsGroup label="Data and account">
        <SettingsSection id="data" title="Your data" help="Take a copy, or remove what Daylark keeps about you." icon={<WalletIcon />}><DataControls /></SettingsSection>
        <SettingsSection id="account" title="Account" help="Signed in as you@example.com. Email access is read-only, and anything that changes your calendar or records asks for your approval first." icon={<SettingsIcon />}><SettingsLegalLinks /></SettingsSection>
      </SettingsGroup>
    </div>
  </AppShell>;
}
