import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "../supabase/admin";
import { getRequestContext, remainingRequestMs } from "./request-context";
import { randomUUID } from "node:crypto";
import { reportFailure } from "../observability/report";
import { QueryBudgetUnavailableError, estimateModelCostUsd, recordActualQueryModelCost, reserveQueryModelCost, selectQueryModel } from "./query-budget";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 10_000 });
const DEFAULT_TOKEN_CAP = 12_000;

export class ModelBudgetExceededError extends Error {
  constructor() {
    super("MODEL_TOKEN_BUDGET_EXCEEDED");
    this.name = "ModelBudgetExceededError";
  }
}

export { QueryBudgetUnavailableError as QueryCostLimitExceededError };

/** Who a model call is counted against. A chat request has this in its request context; work that runs outside a request (Perch, background checks) passes `userId`. */
type Actor = { userId: string; requestId: string };
const actorFor = (userId?: string): Actor | undefined => {
  const context = getRequestContext();
  if (context) return { userId: context.userId, requestId: context.requestId };
  return userId ? { userId, requestId: randomUUID() } : undefined;
};

/** Confirmed directly against the API (2026-09-24): `claude-sonnet-5` and `claude-opus-5` both reject a request that sets `temperature` at
 * all ("`temperature` is deprecated for this model", HTTP 400) — only the Haiku family still accepts it. Every call in this codebase sets
 * `temperature: 0` for determinism, so turning on real balanced/high tiers (R32) would have 400'd every one of them the moment a request
 * actually resolved to Sonnet or Opus, not only the trip planner's calls. Fixed once, here, for every call site at once. */
export function supportsTemperature(model: string) {
  return /haiku/i.test(model);
}

/** Found live (R32), twice, in two unrelated call sites (the trip planner's own calls, then ordinary web search) before being fixed here
 * once: every caller's default timeout was a flat 10 seconds, sized for Haiku. Sonnet and Opus are a genuinely slower, more verbose model
 * family for the same prompt, and a caller has to actively remember to pass a longer `timeoutMs` to avoid it — which is exactly the kind of
 * thing that keeps getting forgotten, one call site at a time. The default itself now depends on which model actually got selected, so
 * every caller gets the right headroom automatically; an explicit `timeoutMs` (still clamped to 30s below) still wins when given. */
function defaultTimeoutMsFor(model: string) {
  return supportsTemperature(model) ? 10_000 : 30_000;
}

export async function callClaude(operation: string, params: Anthropic.MessageCreateParamsNonStreaming, options: { userId?: string; timeoutMs?: number } = {}) {
  const actor = actorFor(options.userId);
  const estimatedInputTokens = Math.ceil(JSON.stringify(params.messages).length / 4);
  params = { ...params, model: selectQueryModel(estimatedInputTokens, params.max_tokens) };
  if (!supportsTemperature(params.model)) delete params.temperature;
  const tokenCap = positiveInteger(process.env.MODEL_MAX_TOKENS_PER_CALL, DEFAULT_TOKEN_CAP);
  if (estimatedInputTokens + params.max_tokens > tokenCap) throw new ModelBudgetExceededError();
  reserveQueryModelCost(params.model, estimatedInputTokens, params.max_tokens);
  await reservePersistentBudget(estimatedInputTokens + params.max_tokens, actor);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = performance.now();
    try {
      const requestedTimeout = Number.isFinite(options.timeoutMs) ? Math.max(1000, Math.min(30000, options.timeoutMs!)) : defaultTimeoutMsFor(params.model);
      const timeout = remainingRequestMs(requestedTimeout);
      const signal = getRequestContext()?.signal;
      if (timeout <= 0 || signal?.aborted) throw new DOMException("Query deadline exceeded", "AbortError");
      const response = await client.messages.create(params, { maxRetries: 0, timeout, signal });
      // Cost is added to the chat request when there is one. Work outside a request still has its cost worked out, logged and saved.
      const actualCostUsd = getRequestContext() ? recordActualQueryModelCost(params.model, response.usage.input_tokens, response.usage.output_tokens) : estimateModelCostUsd(params.model, response.usage.input_tokens, response.usage.output_tokens);
      console.info("model_call", JSON.stringify({
        provider: "anthropic",
        operation,
        model: params.model,
        attempt,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
        actualCostUsd: Math.round(actualCostUsd * 1_000_000) / 1_000_000,
        durationMs: Math.round(performance.now() - startedAt),
        outcome: "complete",
      }));
      await recordUsage(operation, params.model, response.usage.input_tokens, response.usage.output_tokens, Math.round(performance.now() - startedAt), actor);
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
  reportFailure("model_call_failed", lastError, { operation, model: params.model });
  throw lastError instanceof Error ? lastError : new Error("MODEL_UNAVAILABLE");
}


async function reservePersistentBudget(tokens: number, actor: Actor | undefined) {
  if (!actor) return;
  // MODEL_DAILY_TOKEN_BUDGET=0 means no daily cap: usage is still recorded below (so spend stays visible), it is just never gated. Any
  // other value, or none set, keeps the safety cap (100,000 tokens/day if unset).
  if (process.env.MODEL_DAILY_TOKEN_BUDGET === "0") return;
  const dailyLimit = positiveInteger(process.env.MODEL_DAILY_TOKEN_BUDGET, 100_000);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_model_tokens", { p_user_id: actor.userId, p_tokens: tokens, p_daily_limit: dailyLimit });
  // Allow local development before the migration is applied, but make it visible.
  if (error) {
    reportFailure("model_budget_reservation_failed", error, { requestId: actor.requestId });
    return;
  }
  if (data !== true) throw new ModelBudgetExceededError();
}

async function recordUsage(operation: string, model: string, inputTokens: number, outputTokens: number, durationMs: number, actor: Actor | undefined) {
  if (!actor) return;
  const admin = createAdminClient();
  const { error } = await admin.rpc("record_model_usage", { p_user_id: actor.userId, p_request_id: actor.requestId, p_operation: operation, p_model: model, p_input_tokens: inputTokens, p_output_tokens: outputTokens, p_duration_ms: durationMs });
  if (error) reportFailure("model_usage_persist_failed", error, { requestId: actor.requestId, operation });
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
