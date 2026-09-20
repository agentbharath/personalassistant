import { describe, expect, it } from "vitest";
import { calculateSloMetrics } from "./slo";

describe("query SLO calculation", () => {
  it("reports healthy service at sufficient volume", () => {
    const rows = Array.from({ length: 100 }, () => ({ outcome: "success", duration_ms: 2_000, actual_cost_usd: "0.002" }));
    expect(calculateSloMetrics(rows).status).toBe("healthy");
  });

  it("detects availability, timeout, latency, and cost breaches", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ outcome: index < 2 ? "timeout" : "success", duration_ms: index < 2 ? 20_001 : 2_000, actual_cost_usd: index < 2 ? 0.11 : 0.001 }));
    expect(calculateSloMetrics(rows).breaches).toEqual(["availability", "p95_latency", "timeout_rate", "p95_cost"]);
  });
});
