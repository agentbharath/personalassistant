"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./TodayView.module.css";
type Status = {enabled: boolean; status: string; checked: number; pending: number; blocked: number; blockedItems: {id: string; subject: string; messageId?: string}[]; note: string; error?: string};
export function FinanceSyncCard() {
 const [state, setState] = useState<Status | null>(null);
 const [busy, setBusy] = useState(false);
 const [notice, setNotice] = useState("");
 const router = useRouter();
 const refresh = useCallback(async () => {
   try { const response = await fetch("/api/finance/sync", {cache: "no-store"}); if (response.ok) setState(await response.json()); }
   catch { /* Keep previously displayed progress during a network outage. */ }
 }, []);
 useEffect(() => { void refresh(); }, [refresh]);
 useEffect(() => {
   if (!state || !["queued", "running"].includes(state.status)) return;
   const timer = setInterval(() => void refresh(), 15000);
   return () => clearInterval(timer);
 }, [state, refresh]);
 async function act(action: string) {
   setBusy(true); setNotice("");
   try {
     const response = await fetch("/api/finance/sync", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({action, ...(action === "exclude" ? {ids: state?.blockedItems.map(item => item.id)} : {})})});
     const body = await response.json();
     if (!response.ok) throw new Error(body.error ?? "Couldn’t update the scan.");
     if (body.url) router.push(body.url); else { setNotice(body.message ?? "Scan resumed."); await refresh(); }
   } catch (error) { setNotice(error instanceof Error ? error.message : "Couldn’t update the scan."); }
   finally { setBusy(false); }
 }
 if (!state?.enabled) return null;
 const scanning = ["queued", "running"].includes(state.status);
 return <section className={styles.card} aria-label="Email bill scanning" style={{marginBottom: "var(--s-4)"}}>
   <h2 className={styles.cardTitle}>Bill scanning (email)</h2>
   <p>{state.note}</p>
   <p role="status">{scanning ? `Checking email in the background · ${state.checked} checked` : `${state.checked} checked · ${state.pending} need a manual look`}</p>
   {state.error && <p>{state.error}{state.error === "Reconnect Google" && <> · <a href="/settings">Reconnect Google</a></>}</p>}
   {state.blocked > 0 && <p>{state.blocked} emails couldn’t be extracted safely. The coverage date stays unchanged until they are resolved.</p>}
   {state.blockedItems?.length > 0 && <details><summary>Review unreadable emails</summary>
     <ul>{state.blockedItems.map(item => <li key={item.id}>{item.subject} {item.messageId && <a href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.messageId)}`} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}</li>)}</ul>
     <p>Excluding these emails means they will not be added as bills. You can add any missing ones manually.</p>
     <button className={styles.action} disabled={busy} onClick={() => void act("exclude")}>Exclude these {state.blockedItems.length} emails from this scan</button>
   </details>}
   <div style={{display: "flex", gap: "var(--s-3)", flexWrap: "wrap"}}>
     {!scanning && state.pending > 0 && <button className={styles.action} disabled={busy} onClick={() => void act("review")}>Review what needs a look</button>}
     {state.status === "idle" && <><button className={styles.action} disabled={busy} onClick={() => void act("sync")}>Check for new bills</button><button className={styles.action} disabled={busy} onClick={() => void act("backfill")}>Scan last 90 days for bills</button></>}
     {state.status === "blocked" && <button className={styles.action} disabled={busy} onClick={() => void act("retry")}>Retry unread emails</button>}
   </div>
   <p className={styles.sub}>UPI is excluded. Utility and other bills found here are added automatically; credit card and loan dues sync from your linked bank instead. Only genuinely unclear emails wait for a manual look.</p>
   {notice && <p role="status">{notice}</p>}
 </section>;
}
