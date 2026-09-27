"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { bankOverview } from "@/lib/plaid/service";
import styles from "./BankConnections.module.css";

type Overview = Awaited<ReturnType<typeof bankOverview>>;
type LinkSession = { sessionId: string; linkToken: string; environment: string };
type LinkHandler = { open(): void; destroy(): void };
declare global { interface Window { Plaid?: { create(options: { token: string; receivedRedirectUri?: string;
  onSuccess(token: string | null): void; onExit(error: unknown): void }): LinkHandler } } }
const SESSION = "daylark.plaid.link";
async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/finance/banks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Bank request failed.");
  return result as T;
}
export function BankConnections() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [offset, setOffset] = useState(0);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const handler = useRef<LinkHandler | null>(null);
  const resumed = useRef(false);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/finance/banks?offset=${offset}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load bank transactions.");
    setData(result); setChoices({});
  }, [offset]);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);
  useEffect(() => () => handler.current?.destroy(), []);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await work(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Bank request failed."); }
    finally { setBusy(false); }
  }
  const openLink = useCallback((session: LinkSession, redirect?: string) => {
    if (!window.Plaid) { setError("Bank connection form is still loading. Try again."); setBusy(false); return; }
    handler.current?.destroy();
    handler.current = window.Plaid.create({ token: session.linkToken, ...(redirect ? { receivedRedirectUri: redirect } : {}),
      onSuccess: async token => {
        setBusy(true); setError("");
        try {
          const result = await post<{ connectionId: string }>({ action: "exchange", sessionId: session.sessionId, ...(token ? { publicToken: token } : {}) });
          sessionStorage.removeItem(SESSION);
          window.history.replaceState({}, "", "/settings/banks");
          setMessage("Bank connected. Fetching your transaction preview…");
          await post({ action: "sync", connectionId: result.connectionId });
          setMessage("Bank connected. Review your transactions below. If history is still preparing, check again shortly.");
        } catch (e) { setError(e instanceof Error ? e.message : "Could not finish connecting."); }
        finally { await refresh().catch(() => undefined); setBusy(false); }
      },
      onExit: error => { setBusy(false); if (error) setError("The bank connection was not completed. Try again or check your Plaid institution access."); },
    });
    handler.current.open();
  }, [refresh]);
  useEffect(() => {
    if (!ready || resumed.current || !new URLSearchParams(window.location.search).has("oauth_state_id")) return;
    resumed.current = true;
    try {
      const saved = sessionStorage.getItem(SESSION);
      if (!saved) throw new Error("The bank connection session expired. Start Connect bank again.");
      setBusy(true); openLink(JSON.parse(saved) as LinkSession, window.location.href);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not resume bank connection."); setBusy(false); }
  }, [ready, openLink]);
  async function connect(connectionId?: string) {
    setBusy(true); setError("");
    try {
      const session = await post<LinkSession>({ action: "link", ...(connectionId ? { connectionId } : {}) });
      sessionStorage.setItem(SESSION, JSON.stringify(session)); openLink(session);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect bank."); setBusy(false); }
  }
  return <div className={styles.page}>
    <Script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setError("Could not load Plaid. Check your connection and try again.")} />
    <ButtonLink href="/settings" variant="ghost">← Settings</ButtonLink>
    <div className={styles.header}><div><h1>Your bank connections</h1><p className={styles.muted}>Review up to 90 days of bank history. Save records to use them in Daylark’s spending answers.</p></div>
      <Button variant="primary" disabled={busy || !ready || !data} onClick={() => connect()}>Connect bank</Button></div>
    <p className={styles.muted}>Connecting saves a private transaction preview. Daylark cannot move money. Gmail remains available for receipts, bills, and payment reminders.</p>
    {data?.environment === "sandbox" && <p className={styles.notice}><strong>Sandbox · test data only.</strong> Bank credentials and transactions are simulated. These records cannot be saved to your real spending totals.</p>}
    {error && <p className={styles.notice} role="alert">{error}</p>}
    {message && <p className={styles.notice} role="status">{message}</p>}
    {!data && !error && <p role="status">Loading bank connections…</p>}
    <div className={styles.cards}>{data?.items.map(item => <section key={item.id} className={styles.card}>
      <h2>{item.institution_name}</h2>
      <p>{item.status === "needs_reconnect" ? "Reconnect needed" : "Connected"}</p>
      {item.accounts.map((a, i) => <p key={i} className={styles.muted}>{a.name}{a.mask ? ` •${a.mask}` : ""}</p>)}
      <p className={styles.muted}>{item.last_synced_at ? `Last checked ${new Date(item.last_synced_at).toLocaleString()}` : "History has not been fetched yet."}</p>
      {item.update_status !== "HISTORICAL_UPDATE_COMPLETE" && <p className={styles.muted}>Initial history may still be preparing.</p>}
      {item.last_error && <p>Last sync did not finish. Try again or reconnect.</p>}
      <div className={styles.actions}>
        <Button disabled={busy} size="sm" onClick={() => run(async () => { await post({ action: "sync", connectionId: item.id }); setMessage("Bank checked. Review new records below."); })}>Check transactions</Button>
        <Button disabled={busy || !ready} size="sm" onClick={() => connect(item.id)}>Reconnect</Button>
        <Button disabled={busy} size="sm" variant="ghost" onClick={() => {
          if (window.confirm(`Disconnect ${item.institution_name}? Bank previews will be removed. Previously saved transactions will remain.`)) run(async () => { await post({ action: "disconnect", connectionId: item.id }); setMessage("Bank disconnected."); });
        }}>Disconnect</Button>
      </div>
    </section>)}</div>
    {data && !data.items.length && <p className={styles.notice}>Connect Chase, Amex, Discover, or Capital One to start. Apple Card automatic sync needs a separate iPhone integration.</p>}
    {data && data.items.length > 0 && <>
      <h2>Transaction preview</h2>
      <p className={styles.muted}>Pending or withdrawn transactions do not count toward spending. Saving a posted record authorizes Daylark to keep its bank amounts, dates, and status updated. Credits may be refunds or income; transfers are excluded from spending.</p>
      <div className={styles.scroll}><table className={styles.table}><thead><tr><th>Date / account</th><th>Merchant</th><th>Amount</th><th>Status / save</th></tr></thead><tbody>
        {data.transactions.map(row => <tr key={row.id}>
          <td>{row.date}<small>{row.institution}</small><small>{row.account}</small></td>
          <td>{row.name}<small>{row.candidate?.direction}</small></td>
          <td className={styles.amount}>{row.currency ? new Intl.NumberFormat("en-US", { style: "currency", currency: row.currency }).format(Math.abs(row.amount)) : Math.abs(row.amount)}{row.amount < 0 ? " credit" : ""}</td>
          <td>{row.removed ? "Withdrawn by bank" : row.pending ? "Pending" : row.issue ? row.issue : row.saved ? "Saved to Daylark" : <>
            <span>Posted</span>
            {data.environment === "production" && <>
              {row.matches.length > 0 && <label>Possible existing record
                <select aria-label={`Match ${row.name} on ${row.date}`} value={choices[row.id] || ""} disabled={busy} onChange={e => setChoices({ ...choices, [row.id]: e.target.value })}>
                  <option value="">Choose before saving</option><option value="new">Separate transaction — save new</option>
                  {row.matches.map(match => <option key={match.id} value={match.id}>{match.merchant} · {match.date}</option>)}
                </select>
              </label>}
              <Button size="sm" disabled={busy || (row.matches.length > 0 && !choices[row.id])} onClick={() => run(async () => {
                const match = choices[row.id];
                const result = await post<{ message: string }>({ action: "import", id: row.id, hash: row.hash, keepSynced: true, ...(match && match !== "new" ? { matchId: match } : {}) });
                setMessage(result.message);
              })}>{choices[row.id] && choices[row.id] !== "new" ? "Match and keep synced" : "Save and keep synced"}</Button>
            </>}
          </>}</td>
        </tr>)}
        {!data.transactions.length && <tr><td colSpan={4}>No transactions available yet. The bank may still be preparing your history; use Check transactions shortly.</td></tr>}
      </tbody></table></div>
      <div className={styles.footer}><Button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
        <span>{data.total ? `${offset + 1}–${Math.min(offset + 50, data.total)} of ${data.total}` : "0 records"}</span>
        <Button disabled={busy || offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>Next</Button></div>
    </>}
  </div>;
}
