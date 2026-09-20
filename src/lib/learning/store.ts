import { decryptText, encryptText } from "@/lib/security/encryption";
import { piiHmac } from "@/lib/security/pii-hmac";
import { createAdminClient } from "@/lib/supabase/admin";
import { NO_LEARNINGS, withLearning, type Learning, type Learnings } from "./learnings";

/** Stable key per learning: a new value for the same thing replaces the old one. */
export function learningKey(learning: Learning) {
  switch (learning.kind) {
    case "default_window": case "default_action": return learning.topic;
    case "sender_alias": case "merchant_alias": return learning.alias.toLowerCase();
    case "merchant_category": case "autopay": return learning.merchant.toLowerCase();
    case "home_location": return "home";
    case "calendar_duration": return "duration";
    case "calendar_buffer": return "buffer";
  }
}

/** R15.1. Learned corrections must never break a request: any storage problem reads as "nothing learned". */
export async function listLearnings(userId: string): Promise<Learning[]> {
  try {
    const { data, error } = await createAdminClient().from("user_learnings").select("value_ciphertext").eq("user_id", userId).order("created_at", { ascending: true }).limit(300);
    if (error || !data) return [];
    return data.flatMap((row) => {
      try { return [JSON.parse(decryptText(row.value_ciphertext as string)) as Learning]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

export async function loadLearnings(userId: string): Promise<Learnings> {
  return (await listLearnings(userId)).reduce(withLearning, NO_LEARNINGS);
}

export async function saveLearning(userId: string, learning: Learning) {
  const { error } = await createAdminClient().from("user_learnings").upsert({
    user_id: userId,
    kind: learning.kind,
    key_hmac: piiHmac(learningKey(learning)),
    value_ciphertext: encryptText(JSON.stringify(learning)),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,kind,key_hmac" });
  if (error) throw error;
}

/** R15.2 */
export async function deleteLearnings(userId: string, learnings: Learning[]) {
  const admin = createAdminClient();
  for (const learning of learnings) {
    const { error } = await admin.from("user_learnings").delete().eq("user_id", userId).eq("kind", learning.kind).eq("key_hmac", piiHmac(learningKey(learning)));
    if (error) throw error;
  }
}

/** R15.3: only reached after the exact confirmation phrase. */
export async function deleteAllLearnings(userId: string) {
  const { error } = await createAdminClient().from("user_learnings").delete().eq("user_id", userId);
  if (error) throw error;
}
