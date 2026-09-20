import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "../supabase/admin";
import { getRequestContext, remainingRequestMs } from "./request-context";
import { QueryBudgetUnavailableError, recordActualQueryModelCost, reserveQueryModelCost, selectQueryModel } from "./query-budget";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 10_000 });
const DEFAULT_TOKEN_CAP = 12_000;

export class ModelBudgetExceededError extends Error {
  constructor() {
    super("MODEL_TOKEN_BUDGET_EXCEEDED");
    this.name = "ModelBudgetExceededError";
  }
}

export { QueryBudgetUnavailableError as QueryCostLimitExceededError };

export async function callClaude(operation: string, params: Anthropic.MessageCreateParamsNonStreaming) {
  const estimatedInputTokens = Math.ceil(JSON.stringify(params.messages).length / 4);
  params = { ...params, model: selectQueryModel(estimatedInputTokens, params.max_tokens) };
  const tokenCap = positiveInteger(process.env.MODEL_MAX_TOKENS_PER_CALL, DEFAULT_TOKEN_CAP);
  if (estimatedInputTokens + params.max_tokens > tokenCap) throw new ModelBudgetExceededError();
  reserveQueryModelCost(params.model, estimatedInputTokens, params.max_tokens);
  await reservePersistentBudget(estimatedInputTokens + params.max_tokens);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = performance.now();
    try {
      const timeout = remainingRequestMs(10_000);
      const signal = getRequestContext()?.signal;
      if (timeout <= 0 || signal?.aborted) throw new DOMException("Query deadline exceeded", "AbortError");
      const response = await client.messages.create(params, { maxRetries: 0, timeout, signal });
      const actualCostUsd = recordActualQueryModelCost(params.model, response.usage.input_tokens, response.usage.output_tokens);
      console.info("model_call", JSON.stringify({
        provider: "anthropic",
        operation,
        model: params.model,
        attempt,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        actualCostUsd: Math.round(actualCostUsd * 1_000_000) / 1_000_000,
        durationMs: Math.round(performance.now() - startedAt),
        outcome: "complete",
      }));
      await recordUsage(operation, params.model, response.usage.input_tokens, response.usage.output_tokens, Math.round(performance.now() - startedAt));
      return response;
    } catch (error) {
      lastError = error;
      const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
      const retryable = status === 408 || status === 409 || status === 429 || (typeof status === "number" && status >= 500);
      console.warn("model_call", JSON.stringify({ provider: "anthropic", operation, model: params.model, attempt, status, durationMs: Math.round(performance.now() - startedAt), outcome: retryable ? "retryable_error" : "terminal_error" }));
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MODEL_UNAVAILABLE");
}


async function reservePersistentBudget(tokens: number) {
  const context = getRequestContext();
  if (!context) return;
  const dailyLimit = positiveInteger(process.env.MODEL_DAILY_TOKEN_BUDGET, 100_000);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_model_tokens", { p_user_id: context.userId, p_tokens: tokens, p_daily_limit: dailyLimit });
  // Allow local development before the migration is applied, but make it visible.
  if (error) {
    console.warn("model_budget_reservation_failed", JSON.stringify({ requestId: context.requestId, code: error.code }));
    return;
  }
  if (data !== true) throw new ModelBudgetExceededError();
}

async function recordUsage(operation: string, model: string, inputTokens: number, outputTokens: number, durationMs: number) {
  const context = getRequestContext();
  if (!context) return;
  const admin = createAdminClient();
  const { error } = await admin.rpc("record_model_usage", { p_user_id: context.userId, p_request_id: context.requestId, p_operation: operation, p_model: model, p_input_tokens: inputTokens, p_output_tokens: outputTokens, p_duration_ms: durationMs });
  if (error) console.warn("model_usage_persist_failed", JSON.stringify({ requestId: context.requestId, code: error.code }));
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
