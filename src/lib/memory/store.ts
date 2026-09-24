import { assertToolAllowed } from "@/lib/agents/registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptText, encryptText } from "@/lib/security/encryption";
import type { Memory, MemoryCategory, MemoryStatus, MemoryStrength, MemoryType } from "./types";

const COLUMNS = "id, type, category, strength, statement_ciphertext, status, superseded_by, valid_until, created_at";

type Row = { id: string; type: MemoryType; category: MemoryCategory; strength: MemoryStrength; statement_ciphertext: string; status: MemoryStatus; superseded_by: string | null; valid_until: string | null; created_at: string };

function decode(row: Row): Memory {
  return { id: row.id, type: row.type, category: row.category, strength: row.strength, statement: decryptText(row.statement_ciphertext), status: row.status, supersededBy: row.superseded_by, validUntil: row.valid_until, createdAt: row.created_at };
}

/** Reads only; a memory whose validUntil has passed is left out even if a nightly job hasn't marked it expired yet. */
export async function listMemories(userId: string, statuses: MemoryStatus[] = ["active"]): Promise<Memory[]> {
  assertToolAllowed("general", "memory.read");
  const { data, error } = await createAdminClient().from("memories").select(COLUMNS).eq("user_id", userId).in("status", statuses).order("created_at", { ascending: true });
  if (error) throw error;
  const now = new Date().toISOString();
  return (data ?? []).filter((row) => !row.valid_until || row.valid_until > now).map(decode);
}

async function logEvent(userId: string, memoryId: string | null, action: "add" | "update" | "supersede" | "confirm" | "reject" | "expire" | "forget", detail?: unknown) {
  try {
    await createAdminClient().from("memory_events").insert({ user_id: userId, memory_id: memoryId, action, detail_ciphertext: detail ? encryptText(JSON.stringify(detail)) : null });
  } catch { /* An audit-log failure never blocks the real write; R28-style best-effort logging. */ }
}

export type NewMemory = { type: MemoryType; category: MemoryCategory; strength: MemoryStrength; statement: string; status?: MemoryStatus; validUntil?: string | null; sourceExcerpt?: string | null };

export async function createMemory(userId: string, input: NewMemory): Promise<string> {
  assertToolAllowed("general", "memory.write");
  const { data, error } = await createAdminClient().from("memories").insert({
    user_id: userId, type: input.type, category: input.category, strength: input.strength,
    statement_ciphertext: encryptText(input.statement), status: input.status ?? "active",
    valid_until: input.validUntil ?? null, source_excerpt_ciphertext: input.sourceExcerpt ? encryptText(input.sourceExcerpt) : null,
  }).select("id").single();
  if (error) throw error;
  await logEvent(userId, data.id as string, "add", { status: input.status ?? "active" });
  return data.id as string;
}

/** The old memory stays in the table (never overwritten), marked superseded and pointing at its replacement, so history is never lost (R.memory-2). */
export async function supersedeMemory(userId: string, oldId: string, newId: string) {
  assertToolAllowed("general", "memory.write");
  const { error } = await createAdminClient().from("memories").update({ status: "superseded", superseded_by: newId, updated_at: new Date().toISOString() }).eq("id", oldId).eq("user_id", userId);
  if (error) throw error;
  await logEvent(userId, oldId, "supersede", { supersededBy: newId });
}

/** A pending (inferred) memory the person confirmed is true. */
export async function confirmMemory(userId: string, id: string) {
  assertToolAllowed("general", "memory.write");
  const { error } = await createAdminClient().from("memories").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).eq("status", "pending");
  if (error) throw error;
  await logEvent(userId, id, "confirm");
}

/** A pending (inferred) memory the person said was wrong. Kept as a rejected row (not deleted) so the same guess isn't re-filed. */
export async function rejectMemory(userId: string, id: string) {
  assertToolAllowed("general", "memory.write");
  const { error } = await createAdminClient().from("memories").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).eq("status", "pending");
  if (error) throw error;
  await logEvent(userId, id, "reject");
}

/** Real deletion (R.memory-7): "forget X" removes the row itself, not just a status flag, so it can never resurface. */
export async function forgetMemory(userId: string, id: string) {
  assertToolAllowed("general", "memory.forget");
  const { error } = await createAdminClient().from("memories").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await logEvent(userId, null, "forget", { id });
}
