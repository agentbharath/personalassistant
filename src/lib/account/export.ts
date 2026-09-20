import { decryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE = 1_000;
const MAX_ROWS = 50_000;

/** Decrypts one stored value; a value that cannot be read is reported as null, not allowed to fail the whole export. */
function plain(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try { return decryptText(value); } catch { return null; }
}

type Row = Record<string, unknown>;

/** Reads every row for the user in pages, so a large history does not hit the API's row cap. */
async function readAll(table: string, columns: string, userId: string, order: string): Promise<Row[]> {
  const admin = createAdminClient();
  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await admin.from(table).select(columns).eq("user_id", userId).order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

/**
 * Everything Daylark holds for one user, in readable form: conversations and messages, learned preferences, spending records, bills and
 * feedback. Sign-in tokens are left out on purpose (they are credentials, not the user's data); only which connections exist is listed.
 */
export async function buildAccountExport(userId: string, email: string | null) {
  const [conversations, messages, learnings, transactions, sources, bills, feedback, connections] = await Promise.all([
    readAll("conversations", "id, title_ciphertext, pinned_at, created_at, updated_at", userId, "created_at"),
    readAll("conversation_messages", "conversation_id, role, content_ciphertext, sequence_number, created_at", userId, "created_at"),
    readAll("user_learnings", "kind, value_ciphertext, created_at, updated_at", userId, "created_at"),
    readAll("finance_transactions", "id, occurred_on, amount_minor, currency, direction, merchant_ciphertext, category, note_ciphertext, created_at", userId, "occurred_on"),
    readAll("finance_transaction_sources", "transaction_id, source_type, created_at", userId, "created_at"),
    readAll("finance_bills", "id, merchant_ciphertext, amount_minor, currency, category, statement_date, due_date, status, paid_on, created_at", userId, "statement_date"),
    readAll("message_feedback", "conversation_id, sequence_number, rating, note_ciphertext, created_at", userId, "created_at"),
    readAll("oauth_connections", "capability, scopes, created_at, updated_at", userId, "created_at"),
  ]);

  const byConversation = new Map<string, Row[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversation_id as string) ?? [];
    list.push({ sequence: message.sequence_number, role: message.role, content: plain(message.content_ciphertext), at: message.created_at });
    byConversation.set(message.conversation_id as string, list);
  }
  const sourcesByTransaction = new Map<string, string[]>();
  for (const source of sources) {
    const list = sourcesByTransaction.get(source.transaction_id as string) ?? [];
    list.push(source.source_type as string);
    sourcesByTransaction.set(source.transaction_id as string, list);
  }

  return {
    exportedAt: new Date().toISOString(),
    account: { email },
    note: "This is a copy of the data Daylark stores for you. Sign-in tokens are not included.",
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: plain(conversation.title_ciphertext),
      pinned: conversation.pinned_at !== null,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      messages: byConversation.get(conversation.id as string) ?? [],
    })),
    learnedPreferences: learnings.map((learning) => { const value = plain(learning.value_ciphertext); try { return value ? JSON.parse(value) : { kind: learning.kind }; } catch { return { kind: learning.kind }; } }),
    spending: transactions.map((transaction) => ({
      date: transaction.occurred_on,
      direction: transaction.direction,
      merchant: plain(transaction.merchant_ciphertext),
      amount: Number(transaction.amount_minor) / 100,
      currency: transaction.currency,
      category: transaction.category,
      note: plain(transaction.note_ciphertext),
      sources: sourcesByTransaction.get(transaction.id as string) ?? [],
    })),
    bills: bills.map((bill) => ({
      merchant: plain(bill.merchant_ciphertext),
      amount: Number(bill.amount_minor) / 100,
      currency: bill.currency,
      category: bill.category,
      statementDate: bill.statement_date,
      dueDate: bill.due_date,
      status: bill.status,
      paidOn: bill.paid_on,
    })),
    answerFeedback: feedback.map((item) => ({ conversationId: item.conversation_id, message: item.sequence_number, rating: item.rating, note: plain(item.note_ciphertext) })),
    connections: connections.map((connection) => ({ service: connection.capability, permissions: connection.scopes, connectedAt: connection.created_at })),
  };
}
