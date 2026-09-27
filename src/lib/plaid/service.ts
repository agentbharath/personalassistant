import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptText, decryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";
import { PlaidError, plaidConfig, plaidRequest, syncSchema, type PlaidEnvironment, type PlaidTransaction } from "./client";
import { comparableMerchant, normalizeBankTransaction } from "./normalize";

type BankConnection = {
  id: string; user_id: string; environment: PlaidEnvironment; item_id: string; institution_name: string;
  access_token_ciphertext: string; cursor_ciphertext: string | null; accounts_ciphertext: string | null;
  status: string; update_status: string | null; last_error: string | null; last_synced_at: string | null;
};
type BankRow = { id: string; connection_id: string; content_hash: string; payload_ciphertext: string; pending: boolean; removed: boolean; ledger_id: string | null };
function databaseError(error: { code?: string } | null) {
  if (!error) return;
  throw new PlaidError(["42P01", "PGRST205", "PGRST202"].includes(error.code || "") ? "BANK_SETUP_REQUIRED" : "BANK_DATABASE_ERROR");
}
async function connection(userId: string, id: string): Promise<BankConnection> {
  const { data, error } = await createAdminClient().from("bank_connections").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
  databaseError(error);
  if (!data) throw new PlaidError("BANK_NOT_FOUND");
  if (data.environment !== plaidConfig().environment) throw new PlaidError("PLAID_ENV_MISMATCH");
  return data as BankConnection;
}
async function claim(userId: string, id: string) {
  await connection(userId, id);
  const lease = randomUUID();
  const { data, error } = await createAdminClient().rpc("claim_bank_connection", { p_user_id: userId, p_id: id, p_lease: lease });
  databaseError(error);
  if (!data?.[0]) throw new PlaidError("BANK_BUSY");
  return { item: data[0] as BankConnection, lease };
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
    ...(item ? { access_token: decryptText(item.access_token_ciphertext) } : { products: ["transactions"], transactions: { days_requested: 90 } }),
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
    return item.id;
  }
  if (!publicToken) throw new PlaidError("LINK_EXPIRED");
  const exchanged = await plaidRequest<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
  // Persist immediately so a later metadata failure never strands a live token.
  const saved = await admin.from("bank_connections").insert({ user_id: userId, environment: plaidConfig().environment,
    item_id: exchanged.item_id, access_token_ciphertext: encryptText(exchanged.access_token), institution_name: "Connected bank" }).select("id").single();
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
      await admin.from("bank_connections").update({ institution_name: institution.institution.name }).eq("user_id", userId).eq("id", id);
    }
  } catch { /* Linking succeeded; metadata can be retried independently. */ }
  return id;
}

export function bankRecord(itemId: string, transaction: PlaidTransaction) {
  const { candidate } = normalizeBankTransaction(transaction);
  return {
    provider_ref: piiHmac(`${itemId}:${transaction.transaction_id}`), occurred_on: transaction.date, pending: transaction.pending,
    content_hash: piiHmac(JSON.stringify(transaction)), payload_ciphertext: encryptText(JSON.stringify(transaction)),
    ledger_fields: candidate ? { occurred_on: candidate.occurredOn, amount_minor: candidate.amountMinor, currency: candidate.currency,
      direction: candidate.direction, merchant_ciphertext: encryptText(candidate.merchant), merchant_hash: piiHmac(comparableMerchant(candidate.merchant)),
      category: candidate.category, note_ciphertext: encryptText(candidate.note || "Bank transaction") } : null,
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

export async function syncBank(userId: string, id: string) {
  const { item, lease } = await claim(userId, id);
  try {
    const result = await collectBankSync(decryptText(item.access_token_ciphertext), item.cursor_ciphertext ? decryptText(item.cursor_ciphertext) : undefined, item.environment);
    const { error } = await createAdminClient().rpc("apply_bank_sync", { p_user_id: userId, p_id: id, p_lease: lease,
      p_rows: result.transactions.map(t => bankRecord(item.item_id, t)), p_removed: result.removed.map(ref => piiHmac(`${item.item_id}:${ref}`)),
      p_cursor: encryptText(result.cursor), p_accounts: encryptText(JSON.stringify(result.accounts)), p_status: result.status });
    databaseError(error);
    return { changed: result.transactions.length, removed: result.removed.length, status: result.status };
  } catch (error) {
    await release(userId, id, lease, error instanceof PlaidError ? error.code : "BANK_SYNC_FAILED").catch(() => undefined);
    throw error;
  }
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
  const result = await admin.from("bank_connections").select("id,institution_name,status,update_status,last_error,last_synced_at,accounts_ciphertext")
    .eq("user_id", userId).eq("environment", environment).order("created_at");
  databaseError(result.error);
  const items = (result.data || []).map(({ accounts_ciphertext, ...row }) => ({ ...row, accounts: accounts_ciphertext ? JSON.parse(decryptText(accounts_ciphertext)) as { account_id: string; name: string; mask: string | null }[] : [] }));
  if (!items.length) return { environment, items, transactions: [], total: 0 };
  const records = await admin.from("bank_transactions").select("id,connection_id,content_hash,payload_ciphertext,pending,removed,ledger_id", { count: "exact" })
    .eq("user_id", userId).in("connection_id", items.map(i => i.id)).order("occurred_on", { ascending: false }).order("id").range(offset, offset + 49);
  databaseError(records.error);
  const transactions = await Promise.all(((records.data || []) as BankRow[]).map(async row => {
    const transaction = JSON.parse(decryptText(row.payload_ciphertext)) as PlaidTransaction;
    const { candidate, issue } = normalizeBankTransaction(transaction);
    const item = items.find(i => i.id === row.connection_id)!;
    const account = item.accounts.find(a => a.account_id === transaction.account_id);
    const matches: { id: string; merchant: string; date: string }[] = [];
    if (candidate && !row.ledger_id && !row.pending && !row.removed && environment === "production") {
      const date = Date.parse(`${candidate.occurredOn}T12:00:00Z`);
      const near = await admin.from("finance_transactions").select("id,merchant_ciphertext,occurred_on")
        .eq("user_id", userId).eq("amount_minor", candidate.amountMinor).eq("currency", candidate.currency).eq("direction", candidate.direction)
        .eq("bank_voided", false).gte("occurred_on", new Date(date - 3 * 86400000).toISOString().slice(0, 10))
        .lte("occurred_on", new Date(date + 3 * 86400000).toISOString().slice(0, 10)).limit(10);
      databaseError(near.error);
      for (const match of near.data || []) matches.push({ id: match.id, merchant: decryptText(match.merchant_ciphertext), date: match.occurred_on });
    }
    return { id: row.id, hash: row.content_hash, connectionId: row.connection_id, institution: item.institution_name,
      account: account ? `${account.name}${account.mask ? ` •${account.mask}` : ""}` : "Bank account", candidate, issue, matches,
      date: transaction.date, name: transaction.merchant_name || transaction.name, amount: transaction.amount, currency: transaction.iso_currency_code,
      pending: row.pending, removed: row.removed, saved: Boolean(row.ledger_id) };
  }));
  return { environment, items: items.map(({ accounts, ...row }) => ({ ...row, accounts: accounts.map(a => ({ name: a.name, mask: a.mask })) })), transactions, total: records.count || 0 };
}

export async function importBankRecord(userId: string, id: string, hash: string, match?: string) {
  const { error } = await createAdminClient().rpc("import_bank_transaction", { p_user_id: userId, p_id: id, p_hash: hash, p_match: match || null });
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
