import { DEFAULT_REPLY_KINDS, REPLY_KINDS, type ReplyKind } from "@/lib/agents/reply-needed";
import { createAdminClient } from "@/lib/supabase/admin";
import { piiHmac } from "@/lib/security/pii-hmac";

/** R27: only a keyed hash of the Gmail thread id is stored, so the table reveals nothing about the mail. */
export const threadKey = (threadId: string) => piiHmac(`reply-thread:${threadId}`);

export async function listDismissedThreads(userId: string): Promise<Set<string>> {
  const { data, error } = await createAdminClient().from("reply_dismissals").select("thread_hmac").eq("user_id", userId);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.thread_hmac as string));
}

/** Dismissed for good: a dismissed thread does not come back, even if the sender writes again. */
export async function dismissThread(userId: string, threadId: string) {
  const { error } = await createAdminClient().from("reply_dismissals").upsert({ user_id: userId, thread_hmac: threadKey(threadId) }, { onConflict: "user_id,thread_hmac", ignoreDuplicates: true });
  if (error) throw error;
}

export type PerchPrefs = {
  /** False until the owner has answered the first-visit question. Nothing is read for the reply card before that. */
  saved: boolean;
  perchEnabled: boolean;
  remindersEnabled: boolean;
  kinds: ReplyKind[];
};

export const NO_PERCH_PREFS: PerchPrefs = { saved: false, perchEnabled: true, remindersEnabled: true, kinds: DEFAULT_REPLY_KINDS };

const knownKinds = (kinds: string[]) => kinds.filter((kind): kind is ReplyKind => (REPLY_KINDS as readonly string[]).includes(kind));

export async function loadPerchPrefs(userId: string): Promise<PerchPrefs> {
  const { data, error } = await createAdminClient().from("perch_preferences").select("kinds, perch_enabled, reminders_enabled").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return NO_PERCH_PREFS;
  return { saved: true, perchEnabled: data.perch_enabled as boolean, remindersEnabled: data.reminders_enabled as boolean, kinds: knownKinds(data.kinds as string[]) };
}

/** Saves the choices that are given and keeps the rest. Saving anything counts as having answered the first-visit question. */
export async function savePerchPrefs(userId: string, patch: Partial<Omit<PerchPrefs, "saved">>) {
  const current = await loadPerchPrefs(userId);
  const next = { ...current, ...patch };
  const { error } = await createAdminClient().from("perch_preferences").upsert({
    user_id: userId,
    kinds: next.kinds,
    perch_enabled: next.perchEnabled,
    reminders_enabled: next.remindersEnabled,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
}

/** For the navigation: a failed lookup never hides Perch. */
export async function isPerchEnabled(userId: string | undefined) {
  if (!userId) return true;
  return (await loadPerchPrefs(userId).catch(() => NO_PERCH_PREFS)).perchEnabled;
}
