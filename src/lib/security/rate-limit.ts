import { createAdminClient } from "@/lib/supabase/admin";

/** Shared atomic counters: no per-process fallback that resets on serverless cold starts. */
export async function financialRateLimit(userId: string, scope: "read" | "write" | "link" | "export") {
  const { data, error } = await createAdminClient().rpc("take_financial_request", { p_user_id: userId, p_scope: scope });
  if (error || typeof data !== "boolean") throw new Error("RATE_LIMIT_UNAVAILABLE");
  return data;
}
