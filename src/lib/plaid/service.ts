import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptText, decryptText } from "@/lib/security/encryption";
import { openFinancialFields, readFinancialRows, sealFinancialFields } from "@/lib/security/financial-data";
import { piiHmac } from "@/lib/security/pii-hmac";
import { PlaidError, plaidConfig, plaidRequest, syncSchema, liabilitiesSchema, type PlaidEnvironment, type PlaidTransaction } from "./client";
import { comparableMerchant, normalizeBankTransaction } from "./normalize";
import { createBill } from "@/lib/tools/finance/bills";

type BankConnection = {
  id: string; user_id: string; environment: PlaidEnvironment; item_id: string; institution_name: string; metadata_ciphertext?: string;
  access_token_ciphertext: string; cursor_ciphertext: string | null; accounts_ciphertext: string | null;
  status: string; update_status: string | null; last_error: string | null; last_synced_at: string | null;
};
type BankRow = { id: string; connection_id: string; content_hash: string; payload_ciphertext: string; pending: boolean; removed: boolean; ledger_id: string | null };
function databaseError(error: { code?: string } | null) {
  if (!error) return;
  throw new PlaidError(["42P01", "PGRST205", "PGRST202"].includes(error.code || "") ? "BANK_SETUP_REQUIRED" : "BANK_DATABASE_ERROR");
}
function openConnection(row: BankConnection) {
  return row.metadata_ciphertext ? { ...row, ...JSON.parse(decryptText(row.metadata_ciphertext, `daylark:bank:${row.user_id}`)) } as BankConnection : row;
}
function sealConnection(userId: string, itemId: string, institution: string) {
  return { item_id: null, institution_name: null, item_ref_hmac: piiHmac(`item:${itemId}`),
    metadata_ciphertext: encryptText(JSON.stringify({ item_id: itemId, institution_name: institution }), `daylark:bank:${userId}`) };
}
function matchingRecords(rows: Record<string, any>[], candidate: NonNullable<ReturnType<typeof normalizeBankTransaction>["candidate"]>) {
  return rows.filter(row => !row.bank_voided && Number(row.amount_minor) === candidate.amountMinor && row.currency === candidate.currency
    && row.direction === candidate.direction && Math.abs(Date.parse(row.occurred_on) - Date.parse(candidate.occurredOn)) <= 3 * 86400000
    && comparableMerchant(decryptText(row.merchant_ciphertext)) === comparableMerchant(candidate.merchant));
}
async function connection(userId: string, id: string): Promise<BankConnection> {
  const { data, error } = await createAdminClient().from("bank_connections").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
  databaseError(error);
  if (!data) throw new PlaidError("BANK_NOT_FOUND");
  if (data.environment !== plaidConfig().environment) throw new PlaidError("PLAID_ENV_MISMATCH");
  return openConnection(data as BankConnection);
}
async function claim(userId: string, id: string) {
  await connection(userId, id);
  const lease = randomUUID();
  const { data, error } = await createAdminClient().rpc("claim_bank_connection", { p_user_id: userId, p_id: id, p_lease: lease });
  databaseError(error);
  if (!data?.[0]) throw new PlaidError("BANK_BUSY");
  return { item: openConnection(data[0] as BankConnection), lease };
}
async function release(userId: string, id: string, lease: string, code?: string) {
  const { error } = await createAdminClient().from("bank_connections").update({ lease_id: null, lease_until: null,
    ...(code ? { last_error: code, ...(["ITEM_LOGIN_REQUIRED", "INVALID_ACCESS_TOKEN"].includes(code) ? { status: "needs_reconnect" } : {}) } : {})
  }).eq("user_id", userId).eq("id", id).eq("lease_id", lease);
  databaseError(error);
}

export async function createBankLink(userId: string, connectionId?: string) {
  const config = plaidConfig();
  const admin = createAdminClient();
  // Check storage before creating any provider session.
  const check = await admin.from("bank_connections").select("id", { count: "exact", head: true }).eq("user_id", userId);
  databaseError(check.error);
  if (!connectionId && (check.count || 0) >= 10) throw new PlaidError("BANK_CONNECTION_LIMIT");
  const item = connectionId ? await connection(userId, connectionId) : null;
  const redirectUri = process.env.PLAID_REDIRECT_URI;
  if (config.environment === "production" && !redirectUri) throw new PlaidError("PLAID_REDIRECT_REQUIRED");
  if (redirectUri) {
    const url = new URL(redirectUri);
    if (url.pathname !== "/settings/banks" || (url.protocol !== "https:" && !(config.environment === "sandbox" && url.hostname === "localhost"))) throw new PlaidError("PLAID_REDIRECT_REQUIRED");
  }
  const result = await plaidRequest<{ link_token: string; expiration: string }>("/link/token/create", {
    user: { client_user_id: userId }, client_name: "Daylark", language: "en", country_codes: ["US"],
    // Plaid's documented ceiling for the Transactions product; actual history returned still depends on what the institution has.
    // Liabilities (due dates/minimum payments) alongside Transactions. Update mode (an existing item) only
    // re-authenticates products already granted unless a new one is explicitly requested via
    // additional_consented_products -- required_if_supported_products only applies to a fresh Link/Item.
    ...(item ? { access_token: decryptText(item.access_token_ciphertext), additional_consented_products: ["liabilities"] }
      : { products: ["transactions"], required_if_supported_products: ["liabilities"], transactions: { days_requested: 730 } }),
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });
  const { data, error } = await admin.from("bank_link_sessions").insert({ user_id: userId, environment: config.environment,
    connection_id: connectionId || null, expires_at: result.expiration }).select("id").single();
  databaseError(error);
  return { sessionId: data!.id as string, linkToken: result.link_token, environment: config.environment };
}

export async function completeBankLink(userId: string, sessionId: string, publicToken?: string) {
  const admin = createAdminClient();
  const { data: session, error } = await admin.from("bank_link_sessions").update({ consumed_at: new Date().toISOString() })
    .eq("id", sessionId).eq("user_id", userId).eq("environment", plaidConfig().environment).is("consumed_at", null)
    .gt("expires_at", new Date().toISOString()).select("connection_id").maybeSingle();
  databaseError(error);
  if (!session) throw new PlaidError("LINK_EXPIRED");
  if (session.connection_id) {
    const item = await connection(userId, session.connection_id);
    const checked = await plaidRequest<{ item: { error: unknown } }>("/item/get", { access_token: decryptText(item.access_token_ciphertext) }, item.environment);
    if (checked.item.error) throw new PlaidError("ITEM_LOGIN_REQUIRED");
    const update = await admin.from("bank_connections").update({ status: "connected", last_error: null }).eq("user_id", userId).eq("id", item.id);
    databaseError(update.error);
    // Best effort: the connection is already live, so a failed first sync doesn't fail the relink. "Check transactions" remains available.
    await syncBank(userId, item.id).catch(() => undefined);
    return item.id;
  }
  if (!publicToken) throw new PlaidError("LINK_EXPIRED");
  const exchanged = await plaidRequest<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
  // Persist immediately so a later metadata failure never strands a live token.
  const saved = await admin.from("bank_connections").insert({ user_id: userId, environment: plaidConfig().environment,
    ...sealConnection(userId, exchanged.item_id, "Connected bank"), access_token_ciphertext: encryptText(exchanged.access_token) }).select("id").single();
  if (saved.error) {
    // Compensate for a failed local save. No credential is written to logs.
    await plaidRequest("/item/remove", { access_token: exchanged.access_token }).catch(() => undefined);
    databaseError(saved.error);
  }
  const id = saved.data!.id as string;
  try {
    const result = await plaidRequest<{ item: { institution_id: string | null } }>("/item/get", { access_token: exchanged.access_token });
    if (result.item.institution_id) {
      const institution = await plaidRequest<{ institution: { name: string } }>("/institutions/get_by_id", { institution_id: result.item.institution_id, country_codes: ["US"] });
      await admin.from("bank_connections").update(sealConnection(userId, exchanged.item_id, institution.institution.name)).eq("user_id", userId).eq("id", id);
    }
  } catch { /* Linking succeeded; metadata can be retried independently. */ }
  // Best effort: the connection is already live, so a failed first sync doesn't fail the link. "Check transactions" remains available.
  await syncBank(userId, id).catch(() => undefined);
  return id;
}

export function bankRecord(itemId: string, transaction: PlaidTransaction, userId: string) {
  const { candidate } = normalizeBankTransaction(transaction);
  return {
    provider_ref: piiHmac(`${itemId}:${transaction.transaction_id}`), occurred_on: null, pending: null,
    content_hash: piiHmac(JSON.stringify(transaction)), payload_ciphertext: encryptText(JSON.stringify(transaction)),
    ledger_fields: candidate && !transaction.pending ? { ...sealFinancialFields("finance_transactions", userId, { occurred_on: candidate.occurredOn, amount_minor: candidate.amountMinor, currency: candidate.currency, direction: candidate.direction, category: candidate.category }), merchant_ciphertext: encryptText(candidate.merchant), merchant_hash: piiHmac(comparableMerchant(candidate.merchant)),
      note_ciphertext: encryptText(candidate.note || "Bank transaction") } : null,
  };
}

/** Buffer all pages. A mutation error restarts from the original cursor; nothing
 * reaches the DB until the complete update and cursor can commit atomically. */
export async function collectBankSync(accessToken: string, cursor: string | undefined, environment: PlaidEnvironment,
  request = plaidRequest, deadline = Date.now() + 45_000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let next = cursor;
    const transactions = new Map<string, PlaidTransaction>();
    const removed = new Set<string>();
    try {
      for (let page = 0; page < 20; page++) {
        if (Date.now() > deadline) throw new PlaidError("BANK_SYNC_TIMEOUT");
        const result = syncSchema.parse(await request("/transactions/sync", { access_token: accessToken, ...(next !== undefined ? { cursor: next } : {}), count: 500 }, environment));
        for (const t of [...result.added, ...result.modified]) { transactions.set(t.transaction_id, t); removed.delete(t.transaction_id); }
        for (const t of result.removed) { transactions.delete(t.transaction_id); removed.add(t.transaction_id); }
        next = result.next_cursor;
        if (!result.has_more) return { transactions: [...transactions.values()], removed: [...removed], cursor: next, accounts: result.accounts, status: result.transactions_update_status || "UNKNOWN" };
      }
      throw new PlaidError("BANK_SYNC_PAGE_LIMIT");
    } catch (error) {
      if (error instanceof PlaidError && error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt === 0) continue;
      throw error;
    }
  }
  throw new PlaidError("BANK_SYNC_RETRY");
}

/**
 * Credit card dues (minimum payment + due date) straight from the bank, no email parsing. Not every institution
 * or Item supports Liabilities (it's request_if_supported, and an existing connection made before this shipped
 * never asked for it) -- a rejection here just means nothing to add this sync, not a failure. createBill's own
 * dedupe fingerprint (merchant + statement date + amount + account) makes re-running this every sync a no-op
 * until the next statement actually posts, so it never re-announces the same due bill twice.
 */
async function syncLiabilities(userId: string, id: string) {
  const item = await connection(userId, id);
  const data = await plaidRequest("/liabilities/get", { access_token: decryptText(item.access_token_ciphertext) }, item.environment)
    .then(raw => liabilitiesSchema.parse(raw)).catch(() => null);
  if (!data) return;
  const accounts = new Map(data.accounts.map(a => [a.account_id, a]));
  for (const credit of data.liabilities.credit ?? []) {
    if (!credit.next_payment_due_date || !credit.minimum_payment_amount) continue;
    const account = accounts.get(credit.account_id);
    await createBill(userId, {
      merchant: account?.name || item.institution_name, amountMinor: Math.round(credit.minimum_payment_amount * 100), currency: "USD",
      category: "other", statementDate: credit.last_statement_issue_date ?? credit.next_payment_due_date, dueDate: credit.next_payment_due_date,
      accountLastFour: account?.mask ?? null,
    }).catch(() => undefined);
  }
}

/**
 * Every posted, non-removed preview not yet in the ledger gets saved automatically -- no per-transaction click.
 * A preview matching exactly one existing record (same amount/currency/direction, +/-3 days) is linked to it
 * instead of creating a duplicate; zero or multiple candidates fall back to a new record, the same as a person
 * manually choosing "Save new" rather than guess which of several near-matches was meant. Sandbox previews are
 * never imported (import_bank_transaction itself enforces this). Best effort per row: one bad preview is left
 * for manual review in the table rather than failing the rest of the batch.
 */
async function autoImportBank(userId: string, id: string, environment: PlaidEnvironment) {
  if (environment !== "production") return 0;
  const admin = createAdminClient();
  const { data, error } = await admin.from("bank_transactions").select("id,content_hash,payload_ciphertext")
    .eq("user_id", userId).eq("connection_id", id).is("ledger_id", null).eq("removed", false);
  if (error || !data?.length) return 0;
  let imported = 0;
  const ledger = await readFinancialRows("finance_transactions", userId);
  for (const row of data) {
    const transaction = JSON.parse(decryptText(row.payload_ciphertext)) as PlaidTransaction;
    const { candidate } = normalizeBankTransaction(transaction);
    if (!candidate || transaction.pending) continue;
    const near = matchingRecords(ledger, candidate);
    let matchId = near.length === 1 ? near[0].id : undefined;
    if (matchId) {
      // A same-amount, same-window record already claimed by another Plaid transaction (a real coincidence, e.g.
      // two similar purchases days apart) is not this row's match -- save as a new record instead of failing.
      const claimed = await admin.from("finance_transaction_sources").select("transaction_id").eq("user_id", userId).eq("transaction_id", matchId).eq("source_type", "plaid").maybeSingle();
      if (claimed.data) matchId = undefined;
    }
    try { await importBankRecord(userId, row.id, row.content_hash, matchId); imported++; } catch { /* left for manual review */ }
  }
  return imported;
}

export async function syncBank(userId: string, id: string) {
  const { item, lease } = await claim(userId, id);
  try {
    const result = await collectBankSync(decryptText(item.access_token_ciphertext), item.cursor_ciphertext ? decryptText(item.cursor_ciphertext) : undefined, item.environment);
    const { error } = await createAdminClient().rpc("apply_bank_sync", { p_user_id: userId, p_id: id, p_lease: lease,
      p_rows: result.transactions.map(t => bankRecord(item.item_id, t, userId)), p_removed: result.removed.map(ref => piiHmac(`${item.item_id}:${ref}`)),
      p_cursor: encryptText(result.cursor), p_accounts: encryptText(JSON.stringify(result.accounts)), p_status: result.status });
    databaseError(error);
    const imported = await autoImportBank(userId, id, item.environment).catch(() => 0);
    await syncLiabilities(userId, id).catch(() => undefined);
    return { changed: result.transactions.length, removed: result.removed.length, status: result.status, imported };
  } catch (error) {
    await release(userId, id, lease, error instanceof PlaidError ? error.code : "BANK_SYNC_FAILED").catch(() => undefined);
    throw error;
  }
}

/**
 * Best-effort freshness sync for a finance question: with no recurring intraday cron, a stale connection would
 * otherwise only refresh once a day. A connection synced within maxAgeMs is left alone so a back-and-forth
 * conversation doesn't re-sync on every message. Never throws -- a failed or slow sync falls back to whatever
 * data is already saved, since the chat answer must not hang on Plaid.
 */
export async function syncIfStale(userId: string, maxAgeMs = 5 * 60 * 1000) {
  let environment;
  try { environment = plaidConfig().environment; } catch { return; }
  const { data, error } = await createAdminClient().from("bank_connections").select("id,last_synced_at")
    .eq("user_id", userId).eq("environment", environment).eq("status", "connected");
  if (error || !data?.length) return;
  const stale = data.filter(c => !c.last_synced_at || Date.now() - Date.parse(c.last_synced_at) > maxAgeMs);
  await Promise.all(stale.map(c => syncBank(userId, c.id).catch(() => undefined)));
}

export async function disconnectBank(userId: string, id: string) {
  const { item, lease } = await claim(userId, id);
  try {
    try { await plaidRequest("/item/remove", { access_token: decryptText(item.access_token_ciphertext) }, item.environment); }
    catch (error) { if (!(error instanceof PlaidError) || error.code !== "INVALID_ACCESS_TOKEN") throw error; }
    const { error } = await createAdminClient().from("bank_connections").delete().eq("id", id).eq("user_id", userId).eq("lease_id", lease);
    databaseError(error); // Approved ledger records remain; bank previews/tokens cascade away.
  } catch (error) { await release(userId, id, lease).catch(() => undefined); throw error; }
}

export async function bankOverview(userId: string, offset = 0) {
  const environment = plaidConfig().environment;
  const admin = createAdminClient();
  const result = await admin.from("bank_connections").select("id,user_id,institution_name,metadata_ciphertext,status,update_status,last_error,last_synced_at,accounts_ciphertext")
    .eq("user_id", userId).eq("environment", environment).order("created_at");
  databaseError(result.error);
  const items = (result.data || []).map(raw => { const { accounts_ciphertext, metadata_ciphertext: _metadata, item_id: _item, user_id: _user, ...row } = openConnection(raw as BankConnection); return ({ ...row, accounts: accounts_ciphertext ? JSON.parse(decryptText(accounts_ciphertext)) as { account_id: string; name: string; mask: string | null }[] : [] }); });
  if (!items.length) return { environment, items, transactions: [], total: 0, imported: 0 };
  const allRecords: BankRow[] = [];
  for (let start = 0; ; start += 1000) {
    const records = await admin.from("bank_transactions").select("id,connection_id,content_hash,payload_ciphertext,pending,removed,ledger_id")
      .eq("user_id", userId).in("connection_id", items.map(i => i.id)).order("id").range(start, start + 999);
    databaseError(records.error);
    allRecords.push(...(records.data || []) as BankRow[]);
    if ((records.data?.length || 0) < 1000) break;
  }
  const decoded = allRecords.map(row => ({ row, transaction: JSON.parse(decryptText(row.payload_ciphertext)) as PlaidTransaction }));
  decoded.sort((a, b) => b.transaction.date.localeCompare(a.transaction.date) || b.row.id.localeCompare(a.row.id));
  const ledger = await readFinancialRows("finance_transactions", userId);
  const transactions = await Promise.all(decoded.slice(offset, offset + 50).map(async ({ row, transaction }) => {
    const { candidate, issue } = normalizeBankTransaction(transaction);
    const item = items.find(i => i.id === row.connection_id)!;
    const account = item.accounts.find(a => a.account_id === transaction.account_id);
    const matches: { id: string; merchant: string; date: string }[] = [];
    if (candidate && !row.ledger_id && !transaction.pending && !row.removed && environment === "production") {
      for (const match of matchingRecords(ledger, candidate).slice(0, 10)) matches.push({ id: match.id, merchant: decryptText(match.merchant_ciphertext), date: match.occurred_on });
    }
    return { id: row.id, hash: row.content_hash, connectionId: row.connection_id, institution: item.institution_name,
      account: account ? `${account.name}${account.mask ? ` •${account.mask}` : ""}` : "Bank account", candidate, issue, matches,
      date: transaction.date, name: transaction.merchant_name || transaction.name, amount: transaction.amount, currency: transaction.iso_currency_code,
      pending: transaction.pending, removed: row.removed, saved: Boolean(row.ledger_id) };
  }));
  return { environment, items: items.map(({ accounts, ...row }) => ({ ...row, accounts: accounts.map(a => ({ name: a.name, mask: a.mask })) })), transactions, total: allRecords.length, imported: allRecords.filter(row => row.ledger_id).length };
}

export async function importBankRecord(userId: string, id: string, hash: string, match?: string) {
  const admin = createAdminClient();
  let matchCiphertext: string | null = null;
  if (match) {
    const preview = await admin.from("bank_transactions").select("payload_ciphertext").eq("user_id", userId).eq("id", id).single();
    const existing = await admin.from("finance_transactions").select("*").eq("user_id", userId).eq("id", match).single();
    databaseError(preview.error); databaseError(existing.error);
    const { candidate } = normalizeBankTransaction(JSON.parse(decryptText(preview.data!.payload_ciphertext)));
    const opened = openFinancialFields("finance_transactions", userId, existing.data!);
    if (!candidate || !existing.data!.financial_ciphertext || !matchingRecords([opened], candidate).length) throw new PlaidError("PREVIEW_CHANGED");
    matchCiphertext = existing.data!.financial_ciphertext;
  }
  const { error } = await admin.rpc("import_bank_transaction", { p_user_id: userId, p_id: id, p_hash: hash, p_match: match || null, p_match_ciphertext: matchCiphertext });
  if (error) throw new PlaidError(error.message?.includes("PREVIEW_CHANGED") ? "PREVIEW_CHANGED" : "BANK_IMPORT_FAILED");
}

export async function removeUserBanks(userId: string) {
  const result = await createAdminClient().from("bank_connections").select("id").eq("user_id", userId);
  if (["42P01", "PGRST205"].includes(result.error?.code || "")) return;
  databaseError(result.error);
  // Fail visibly if revocation fails: retain the token so disconnection can be retried.
  for (const item of result.data || []) await disconnectBank(userId, item.id);
  const sessions = await createAdminClient().from("bank_link_sessions").delete().eq("user_id", userId);
  databaseError(sessions.error);
}
