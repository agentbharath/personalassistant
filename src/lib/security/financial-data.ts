import { decryptText, encryptText } from "./encryption";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export const financialColumns = {
  finance_transactions: ["occurred_on", "amount_minor", "currency", "direction", "category"],
  finance_bills: ["amount_minor", "currency", "category", "statement_date", "due_date", "status", "paid_on"],
} as const;
export type FinancialTable = keyof typeof financialColumns;
type Row = Record<string, any>; // Database rows have a different shape before and after migration.
const context = (table: FinancialTable, userId: string) => `daylark:financial:${table}:${userId}`;
const money = { amount_minor: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/), category: z.string().min(1) };
const schemas = {
  finance_transactions: z.object({ ...money, occurred_on: z.string().date(), direction: z.enum(["expense", "income", "transfer"]) }),
  finance_bills: z.object({ ...money, statement_date: z.string().date(), due_date: z.string().date().nullable(), status: z.enum(["outstanding", "paid"]), paid_on: z.string().date().nullable() }),
};

/** Encrypt financial values before they leave the server. Null legacy columns explicitly. */
export function sealFinancialFields<T extends FinancialTable>(table: T, userId: string, row: Row) {
  const values = schemas[table].parse(Object.fromEntries(financialColumns[table].map(key => [key, row[key] ?? null])));
  return { ...Object.fromEntries(financialColumns[table].map(key => [key, null])) as Record<(typeof financialColumns)[T][number], null>,
    financial_ciphertext: encryptText(JSON.stringify(values), context(table, userId)) };
}

/** Legacy reads exist only to support the resumable backfill; corrupted ciphertext never falls back. */
export function openFinancialFields<T extends Row>(table: FinancialTable, userId: string, row: T): T {
  if (!row.financial_ciphertext) return row;
  const values = schemas[table].parse(JSON.parse(decryptText(row.financial_ciphertext, context(table, userId)))) as Row;
  return { ...row, ...Object.fromEntries(financialColumns[table].map(key => [key, values[key]])) };
}

/** Financial filters run in authenticated server memory, never against plaintext DB columns.
 * Stable UUID pagination avoids the API row cap. Suitable for a personal ledger; no shared plaintext cache. */
export async function readFinancialRows(table: FinancialTable, userId: string) {
  const rows: Row[] = [];
  let after: string | undefined;
  for (;;) {
    let query = createAdminClient().from(table).select("*").eq("user_id", userId).order("id").limit(1000);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error("FINANCIAL_READ_FAILED");
    for (const row of data || []) rows.push(openFinancialFields(table, userId, row));
    if (!data || data.length < 1000) return rows;
    after = data[data.length - 1].id;
  }
}
