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
 return <section className={styles.card} aria-label="Email finance sync" style={{marginBottom: "var(--s-4)"}}>
   <h2 className={styles.cardTitle}>Financial records from email</h2>
   <p>{state.note}</p>
   <p role="status">{scanning ? `Checking email in the background · ${state.checked} checked` : `${state.checked} checked · ${state.pending} ready for review`}</p>
   {state.error && <p>{state.error}{state.error === "Reconnect Google" && <> · <a href="/settings">Reconnect Google</a></>}</p>}
   {state.blocked > 0 && <p>{state.blocked} emails couldn’t be extracted safely. The coverage date stays unchanged until they are resolved.</p>}
   {state.blockedItems?.length > 0 && <details><summary>Review unreadable emails</summary>
     <ul>{state.blockedItems.map(item => <li key={item.id}>{item.subject} {item.messageId && <a href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.messageId)}`} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}</li>)}</ul>
     <p>Excluding these emails means their amounts will not be imported. You can record any missing transactions manually.</p>
     <button className={styles.action} disabled={busy} onClick={() => void act("exclude")}>Exclude these {state.blockedItems.length} emails from this sync</button>
   </details>}
   <div style={{display: "flex", gap: "var(--s-3)", flexWrap: "wrap"}}>
     {!scanning && state.pending > 0 && <button className={styles.action} disabled={busy} onClick={() => void act("review")}>Review records</button>}
     {state.status === "idle" && <><button className={styles.action} disabled={busy} onClick={() => void act("sync")}>Check new email</button><button className={styles.action} disabled={busy} onClick={() => void act("backfill")}>Scan last 90 days</button></>}
     {state.status === "blocked" && <button className={styles.action} disabled={busy} onClick={() => void act("retry")}>Retry unread emails</button>}
   </div>
   <p className={styles.sub}>UPI is excluded. Scanning does not import anything; you review the results first.</p>
   {notice && <p role="status">{notice}</p>}
 </section>;
}
