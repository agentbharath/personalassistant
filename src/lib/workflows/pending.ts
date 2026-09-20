import { createAdminClient } from "@/lib/supabase/admin";

/** True when this conversation has an approval waiting. The router uses it to read "yes" and "no" as answers. */
export async function hasPendingApproval(userId: string, conversationId: string | undefined) {
  if (!conversationId) return false;
  try {
    const { data } = await createAdminClient().from("workflow_checkpoints").select("id").eq("user_id", userId).eq("conversation_id", conversationId).eq("state", "pending_approval").limit(1);
    return Boolean(data?.length);
  } catch {
    return false;
  }
}
