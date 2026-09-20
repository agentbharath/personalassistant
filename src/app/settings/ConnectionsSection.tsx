import { checkGoogleConnection, type ConnectionState } from "@/lib/auth/connection-status";
import { ReconnectButton } from "@/components/settings/ReconnectButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { createAdminClient } from "@/lib/supabase/admin";
import styles from "./settings.module.css";

type State = ConnectionState | "missing";

const badge = (state: State) => ({
  connected: ["Connected", styles.on],
  needs_reconnect: ["Needs reconnecting", styles.off],
  unavailable: ["Couldn’t check", styles.neutral],
  missing: ["Not connected", styles.off],
} as const)[state];

/**
 * The Connections section. It is its own component so the page can show the rest of Settings straight away while this part waits
 * for Google to confirm each saved permission.
 */
export async function ConnectionsSection({ userId }: { userId?: string }) {
  // The connections table has no user-facing access on purpose (it holds sign-in tokens), so the server reads it. Only which
  // permissions exist is taken, never a token, and only for the signed-in user.
  const rows = userId ? await createAdminClient().from("oauth_connections").select("capability").eq("user_id", userId).then((result) => result.data ?? [], () => []) : [];
  const saved = new Set(rows.map((row) => row.capability as string));
  // Ask Google whether each saved permission still works, at the same time, so a revoked one is shown as such.
  const [emailState, calendarState] = await Promise.all((["email", "calendar"] as const).map(async (capability): Promise<State> => (userId && saved.has(capability) ? checkGoogleConnection(userId, capability) : "missing")));
  const allGood = emailState === "connected" && calendarState === "connected";

  return <>
    <ul className={styles.list}>
      <li className={styles.row}>
        <span><strong>Gmail</strong><br /><span className={styles.sub}>Read only. It can search and read messages, and can never send, delete or change them.</span></span>
        <span className={badge(emailState)[1]}>{badge(emailState)[0]}</span>
      </li>
      <li className={styles.row}>
        <span><strong>Google Calendar</strong><br /><span className={styles.sub}>Reads your events. Adds, changes or removes one only after you confirm.</span></span>
        <span className={badge(calendarState)[1]}>{badge(calendarState)[0]}</span>
      </li>
    </ul>
    <p className={styles.actions}>
      <ReconnectButton label={allGood ? "Reconnect Google" : saved.size === 0 ? "Connect Google" : "Fix connection"} />
      <a className={styles.external} href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer noopener">Manage or remove access in Google</a>
    </p>
  </>;
}

/** Shown while Google is being asked. Same height as the real rows, so nothing jumps when it arrives. */
export function ConnectionsFallback() {
  return <div role="status" aria-label="Checking your connections" className={styles.list} style={{ padding: "var(--s-3) var(--s-4)", display: "grid", gap: "var(--s-3)" }}>
    <Skeleton height="2.75rem" />
    <Skeleton height="2.75rem" />
  </div>;
}
