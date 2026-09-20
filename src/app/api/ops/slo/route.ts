import { hasValidInternalBearer } from "@/lib/auth/internal-auth";
import { calculateSloMetrics, SLO_TARGETS, type QueryRunMetric } from "@/lib/observability/slo";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasValidInternalBearer(request)) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await createAdminClient()
    .from("query_runs")
    .select("outcome,duration_ms,actual_cost_usd")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10_000);
  if (error) return Response.json({ status: "unavailable", error: "TELEMETRY_QUERY_FAILED" }, { status: 503 });
  const metrics = calculateSloMetrics((data ?? []) as QueryRunMetric[]);
  return Response.json({ window: "24h", generatedAt: new Date().toISOString(), targets: SLO_TARGETS, ...metrics }, { status: metrics.status === "breached" ? 503 : 200 });
}
