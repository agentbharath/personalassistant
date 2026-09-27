import { z } from "zod";

export type PlaidEnvironment = "sandbox" | "production";
export class PlaidError extends Error {
  constructor(public code: string) { super(code); }
}
export function plaidConfig() {
  const environment = process.env.PLAID_ENV;
  if (environment !== "sandbox" && environment !== "production") throw new PlaidError("PLAID_ENV_REQUIRED");
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_CLIENT_SECRET || process.env.PLAID_SECRET;
  if (!clientId || !secret) throw new PlaidError("PLAID_KEYS_REQUIRED");
  return { environment, clientId, secret };
}
export function plaidConfigured() {
  try { plaidConfig(); return true; } catch { return false; }
}

// Only these read/link endpoints are available; never accept a URL from the browser.
type Endpoint = "/link/token/create" | "/item/public_token/exchange" | "/item/get" | "/institutions/get_by_id" | "/transactions/sync" | "/item/remove" | "/liabilities/get";
export async function plaidRequest<T>(endpoint: Endpoint, body: Record<string, unknown>, environment?: PlaidEnvironment): Promise<T> {
  const config = plaidConfig();
  if (environment && config.environment !== environment) throw new PlaidError("PLAID_ENV_MISMATCH");
  let response: Response;
  try {
    response = await fetch(`https://${config.environment}.plaid.com${endpoint}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { "content-type": "application/json", "Plaid-Version": "2020-09-14", "PLAID-CLIENT-ID": config.clientId, "PLAID-SECRET": config.secret },
      body: JSON.stringify(body),
    });
  } catch { throw new PlaidError("PLAID_UNAVAILABLE"); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof data?.error_code === "string" && /^[A-Z_]+$/.test(data.error_code) ? data.error_code : "PLAID_UNAVAILABLE";
    // Never expose provider bodies, request headers, credentials, or account data in errors.
    throw new PlaidError(code);
  }
  return data as T;
}

export const transactionSchema = z.object({
  transaction_id: z.string().min(1), account_id: z.string().min(1), amount: z.number().finite(),
  iso_currency_code: z.string().nullable(), date: z.iso.date(), pending: z.boolean(),
  name: z.string(), merchant_name: z.string().nullable().optional(), pending_transaction_id: z.string().nullable().optional(),
  personal_finance_category: z.object({ primary: z.string(), detailed: z.string(), confidence_level: z.string().optional() }).nullable().optional(),
});
export type PlaidTransaction = z.infer<typeof transactionSchema>;
export const syncSchema = z.object({
  added: z.array(transactionSchema), modified: z.array(transactionSchema),
  removed: z.array(z.object({ transaction_id: z.string() })),
  accounts: z.array(z.object({ account_id: z.string(), name: z.string(), mask: z.string().nullable(), type: z.string(), subtype: z.string().nullable() })),
  next_cursor: z.string(), has_more: z.boolean(), transactions_update_status: z.string().optional(),
});

// Only credit-card liabilities for now (the common "dues" case). Mortgage/student loan entries follow the same
// shape under liabilities.mortgage / liabilities.student if that's ever wanted.
export const liabilitiesSchema = z.object({
  accounts: z.array(z.object({ account_id: z.string(), name: z.string(), mask: z.string().nullable() })),
  liabilities: z.object({ credit: z.array(z.object({
    account_id: z.string(), is_overdue: z.boolean().nullable().optional(),
    last_statement_balance: z.number().nullable().optional(), last_statement_issue_date: z.string().nullable().optional(),
    minimum_payment_amount: z.number().nullable().optional(), next_payment_due_date: z.string().nullable().optional(),
  })).optional() }),
});
export type PlaidLiabilities = z.infer<typeof liabilitiesSchema>;

export function bankErrorMessage(error: unknown) {
  const code = error instanceof PlaidError ? error.code : "BANK_UNAVAILABLE";
  const messages: Record<string, string> = {
    PLAID_ENV_REQUIRED: "Set PLAID_ENV to sandbox or production in the server environment.",
    PLAID_KEYS_REQUIRED: "Bank connection credentials are not configured.",
    INVALID_API_KEYS: "Plaid rejected the credentials. Check that the secret matches PLAID_ENV.",
    ITEM_LOGIN_REQUIRED: "Reconnect this bank to continue syncing.",
    INVALID_ACCESS_TOKEN: "This bank connection is no longer valid. Reconnect or disconnect it.",
    PRODUCT_NOT_READY: "The bank is preparing your history. Check again shortly.",
    INSTITUTION_NOT_RESPONDING: "The bank is temporarily unavailable. Your saved progress is safe.",
    BANK_BUSY: "This bank is already syncing. Try again shortly.",
    BANK_NOT_FOUND: "This bank connection is unavailable.",
    PREVIEW_CHANGED: "Bank data changed since this preview. Refresh and review it again.",
    LINK_EXPIRED: "The connection session expired. Start Connect bank again.",
    PLAID_ENV_MISMATCH: "This connection belongs to a different Plaid environment.",
    BANK_SETUP_REQUIRED: "Bank storage needs setup. Apply migration 0028 before connecting.",
    PLAID_REDIRECT_REQUIRED: "Configure an HTTPS PLAID_REDIRECT_URI ending in /settings/banks and register it in your Plaid Dashboard.",
    BANK_CONNECTION_LIMIT: "Disconnect an unused bank before adding another connection.",
    SANDBOX_IMPORT_DISABLED: "Sandbox transactions stay in the test preview and cannot enter your real spending totals.",
    BANK_IMPORT_FAILED: "The record could not be saved. It may already be linked; refresh and review it again.",
  };
  return messages[code] || "Bank sync could not finish. Your saved progress is safe; try again shortly.";
}
