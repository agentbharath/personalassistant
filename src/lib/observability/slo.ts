export const SLO_TARGETS = {
  availability: 0.99,
  p95LatencyMs: 20_000,
  timeoutRate: 0.01,
  p95CostUsd: 0.10,
  minimumSamples: 20,
} as const;

export type QueryRunMetric = { outcome: string; duration_ms: number; actual_cost_usd: number | string };

export function calculateSloMetrics(rows: QueryRunMetric[]) {
  const samples = rows.length;
  if (!samples) return { samples: 0, availability: null, p95LatencyMs: null, timeoutRate: null, p95CostUsd: null, status: "insufficient_data" as const, breaches: [] as string[] };
  const successful = rows.filter((row) => row.outcome === "success").length;
  const timeouts = rows.filter((row) => row.outcome === "timeout").length;
  const availability = successful / samples;
  const timeoutRate = timeouts / samples;
  const p95LatencyMs = percentile(rows.map((row) => row.duration_ms), 0.95);
  const p95CostUsd = percentile(rows.map((row) => Number(row.actual_cost_usd)), 0.95);
  const breaches = [
    availability < SLO_TARGETS.availability && "availability",
    p95LatencyMs > SLO_TARGETS.p95LatencyMs && "p95_latency",
    timeoutRate > SLO_TARGETS.timeoutRate && "timeout_rate",
    p95CostUsd > SLO_TARGETS.p95CostUsd && "p95_cost",
  ].filter(Boolean) as string[];
  return {
    samples,
    availability,
    p95LatencyMs,
    timeoutRate,
    p95CostUsd,
    status: samples < SLO_TARGETS.minimumSamples ? "insufficient_data" as const : breaches.length ? "breached" as const : "healthy" as const,
    breaches,
  };
}

function percentile(values: number[], fraction: number) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
