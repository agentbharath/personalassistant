import { createAdminClient } from "@/lib/supabase/admin";

export type QueryTelemetry = {
  userId: string;
  requestId: string;
  conversationId?: string;
  agents: string[];
  status: "completed" | "waiting_for_user" | "partially_completed" | "failed";
  outcome: "success" | "timeout" | "cost_limited" | "provider_error" | "internal_error";
  durationMs: number;
  reservedCostUsd: number;
  actualCostUsd: number;
  errorCode?: string;
  cacheHits?: number;
  cacheMisses?: number;
};

export async function recordQueryTelemetry(event: QueryTelemetry) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("record_query_run", {
    p_user_id: event.userId,
    p_request_id: event.requestId,
    p_conversation_id: event.conversationId ?? null,
    p_agents: event.agents,
    p_status: event.status,
    p_outcome: event.outcome,
    p_duration_ms: Math.max(0, Math.round(event.durationMs)),
    p_reserved_cost_usd: event.reservedCostUsd,
    p_actual_cost_usd: event.actualCostUsd,
    p_error_code: event.errorCode ?? null,
    p_cache_hits: event.cacheHits ?? 0,
    p_cache_misses: event.cacheMisses ?? 0,
  });
  if (error) console.warn("query_telemetry_persist_failed", JSON.stringify({ requestId: event.requestId, code: error.code }));
}
