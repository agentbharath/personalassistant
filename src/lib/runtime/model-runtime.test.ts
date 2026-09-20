import { afterEach, describe, expect, it } from "vitest";
import { ModelBudgetExceededError, QueryCostLimitExceededError, callClaude } from "./model-runtime";
import { withRequestContext } from "./request-context";

afterEach(() => {
  delete process.env.MODEL_MAX_TOKENS_PER_CALL;
  delete process.env.QUERY_MAX_COST_USD;
});

describe("model runtime budget", () => {
  it("rejects a request before the provider call when its token ceiling is exceeded", async () => {
    process.env.MODEL_MAX_TOKENS_PER_CALL = "10";
    await expect(callClaude("test", {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      messages: [{ role: "user", content: "hello" }],
    })).rejects.toBeInstanceOf(ModelBudgetExceededError);
  });

  it("rejects a model call before the provider when the per-query dollar ceiling would be exceeded", async () => {
    process.env.QUERY_MAX_COST_USD = "0.000001";
    await expect(withRequestContext({ requestId: "request", userId: "user", reservedModelCostUsd: 0 }, () => callClaude("test", {
      model: "claude-opus-4-1",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    }))).rejects.toBeInstanceOf(QueryCostLimitExceededError);
  });
});
