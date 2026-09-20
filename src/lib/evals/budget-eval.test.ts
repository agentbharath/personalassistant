import { afterEach, describe, expect, it } from "vitest";
import { withRequestContext } from "@/lib/runtime/request-context";
import { QueryBudgetUnavailableError, prepareAgentStage, queryBudgetSnapshot, reserveQueryModelCost, selectQueryModel } from "@/lib/runtime/query-budget";

afterEach(() => {
  delete process.env.QUERY_MAX_COST_USD;
  delete process.env.ANTHROPIC_FAST_MODEL;
  delete process.env.ANTHROPIC_BALANCED_MODEL;
  delete process.env.ANTHROPIC_HIGH_MODEL;
});

describe("per-query model budget evaluation", () => {
  it("selects a cheaper configured model when the preferred model cannot fit", async () => {
    process.env.QUERY_MAX_COST_USD = "0.01";
    process.env.ANTHROPIC_FAST_MODEL = "claude-haiku-4-5-20251001";
    process.env.ANTHROPIC_BALANCED_MODEL = "claude-sonnet-4-5-20250929";
    await withRequestContext({ requestId: "r", userId: "u", deadlineAt: Date.now() + 20_000, reservedModelCostUsd: 0 }, async () => {
      prepareAgentStage(["general"], "balanced");
      expect(selectQueryModel(1_000, 700)).toContain("haiku");
    });
  });

  it("accumulates cost within one query and exposes the remainder", async () => {
    await withRequestContext({ requestId: "r", userId: "u", deadlineAt: Date.now() + 20_000, reservedModelCostUsd: 0 }, async () => {
      reserveQueryModelCost("claude-haiku-4-5-20251001", 1_000, 100);
      expect(queryBudgetSnapshot().remainingCostUsd).toBeLessThan(0.10);
    });
  });

  it("rejects an agent stage when its query deadline is exhausted", async () => {
    await expect(withRequestContext({ requestId: "r", userId: "u", deadlineAt: Date.now() - 1, reservedModelCostUsd: 0 }, async () => prepareAgentStage(["email"]))).rejects.toThrow(QueryBudgetUnavailableError);
  });
});
