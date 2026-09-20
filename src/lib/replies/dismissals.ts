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
