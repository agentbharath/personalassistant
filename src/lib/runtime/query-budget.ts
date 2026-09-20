import { getRequestContext, remainingRequestMs } from "./request-context";

const DEFAULT_COST_LIMIT_USD = 0.10;

export class QueryBudgetUnavailableError extends Error {
  constructor(public readonly reason: "cost" | "time") {
    super(reason === "cost" ? "QUERY_COST_LIMIT_EXCEEDED" : "QUERY_DEADLINE_TOO_CLOSE");
    this.name = "QueryBudgetUnavailableError";
  }
}

export function prepareAgentStage(agents: string[], preference: "fast" | "balanced" | "high" = "fast") {
  const context = getRequestContext();
  const budget = queryBudgetSnapshot();
  if (budget.remainingMs < 1_200) throw new QueryBudgetUnavailableError("time");
  if (budget.remainingCostUsd <= 0) throw new QueryBudgetUnavailableError("cost");
  if (context) {
    context.activeAgents = agents;
    context.modelPreference = preference;
  }
  console.info("orchestrator_budget", JSON.stringify({
    requestId: context?.requestId,
    agents,
    preference,
    remainingMs: budget.remainingMs,
    remainingCostUsd: roundUsd(budget.remainingCostUsd),
  }));
}

export function selectQueryModel(inputTokens: number, outputTokens: number) {
  const context = getRequestContext();
  const preference = context?.modelPreference ?? "fast";
  const candidates = preference === "high"
    ? [configured("high"), configured("balanced"), configured("fast")]
    : preference === "balanced"
      ? [configured("balanced"), configured("fast")]
      : [configured("fast")];
  const remaining = queryBudgetSnapshot().remainingCostUsd;
  const model = [...new Set(candidates)].find((candidate) => estimateModelCostUsd(candidate, inputTokens, outputTokens) <= remaining);
  if (!model) throw new QueryBudgetUnavailableError("cost");
  return model;
}

export function reserveQueryModelCost(model: string, inputTokens: number, outputTokens: number) {
  const context = getRequestContext();
  if (!context) return;
  const estimatedUsd = estimateModelCostUsd(model, inputTokens, outputTokens);
  const next = (context.reservedModelCostUsd ?? 0) + estimatedUsd;
  if (next > costLimitUsd()) throw new QueryBudgetUnavailableError("cost");
  context.reservedModelCostUsd = next;
}

export function recordActualQueryModelCost(model: string, inputTokens: number, outputTokens: number) {
  const context = getRequestContext();
  if (!context) return 0;
  const actualUsd = estimateModelCostUsd(model, inputTokens, outputTokens);
  context.actualModelCostUsd = (context.actualModelCostUsd ?? 0) + actualUsd;
  return actualUsd;
}

export function queryBudgetSnapshot() {
  const spent = getRequestContext()?.reservedModelCostUsd ?? 0;
  const limit = costLimitUsd();
  return {
    costLimitUsd: limit,
    reservedCostUsd: spent,
    actualCostUsd: getRequestContext()?.actualModelCostUsd ?? 0,
    remainingCostUsd: Math.max(0, limit - spent),
    remainingMs: remainingRequestMs(20_000),
  };
}

export function estimateModelCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const rates = modelRatesPerMillion(model);
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

function configured(tier: "fast" | "balanced" | "high"): string {
  if (tier === "high") return process.env.ANTHROPIC_HIGH_MODEL ?? process.env.ANTHROPIC_BALANCED_MODEL ?? configured("fast");
  if (tier === "balanced") return process.env.ANTHROPIC_BALANCED_MODEL ?? configured("fast");
  return process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-4-5-20251001";
}

function modelRatesPerMillion(model: string) {
  if (/haiku/i.test(model)) return { input: 1, output: 5 };
  if (/sonnet/i.test(model)) return { input: 3, output: 15 };
  if (/opus/i.test(model)) return { input: 15, output: 75 };
  // Models without registered pricing cannot be selected or charged safely.
  throw new QueryBudgetUnavailableError("cost");
}

function costLimitUsd() {
  const parsed = Number(process.env.QUERY_MAX_COST_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COST_LIMIT_USD;
}

function roundUsd(value: number) { return Math.round(value * 1_000_000) / 1_000_000; }
