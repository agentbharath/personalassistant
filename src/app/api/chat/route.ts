import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { runOrchestrator } from "@/lib/orchestrator/run";
import { appendMessage, compactConversationContext, createConversation, getConversation, latestSequence } from "@/lib/conversations/store";
import { randomUUID } from "node:crypto";
import { withRequestContext, type RequestContext } from "@/lib/runtime/request-context";
import * as Sentry from "@sentry/nextjs";
import { QueryBudgetUnavailableError, queryBudgetSnapshot } from "@/lib/runtime/query-budget";
import { ModelBudgetExceededError } from "@/lib/runtime/model-runtime";
import { recordQueryTelemetry } from "@/lib/observability/query-telemetry";
import { resolveRetryMessage } from "@/lib/conversations/retry";

const QUERY_TIMEOUT_MS = 20_000;

const requestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  conversationId: z.string().uuid().optional(),
  isRetry: z.boolean().optional().default(false),
  /** The Confirm or Cancel button on an approval card: a fixed value that needs no interpretation (R20.5). */
  uiAction: z.enum(["confirm", "cancel"]).optional(),
}).refine((value) => !value.isRetry || Boolean(value.conversationId), { message: "Retry requires an existing conversation" });

/**
 * Clients that accept NDJSON get progress lines while the answer is worked out, then one final line with the result.
 * Progress reports which agents are running (real state, not a timer). Everything else about the request is unchanged.
 */
export async function POST(request: Request) {
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) return handle(request);
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      let last = "";
      const onProgress = (agents: string[]) => {
        const key = agents.join(",");
        if (key !== last) { last = key; send({ type: "progress", agents }); }
      };
      send({ type: "progress", agents: [] });
      try {
        const response = await handle(request, onProgress);
        send({ type: "result", status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) });
      } catch {
        send({ type: "result", status: 500, body: { message: "I couldn’t complete that request right now. Nothing unconfirmed was changed.", retryable: true } });
      }
      controller.close();
    },
  }), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

async function handle(request: Request, onProgress?: (agents: string[]) => void): Promise<Response> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });

  let conversationId = parsed.data.conversationId;
  let context: { role: "user" | "assistant"; content: string }[] = [];
  let persistenceWarning: string | undefined;
  const requestId = randomUUID();
  const queryStartedAt = Date.now();
  let queryContext: RequestContext | undefined;

  try {
    if (conversationId) {
      const conversation = await getConversation(userId, conversationId);
      if (!conversation) return Response.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
      context = conversation.contextMessages;
    } else {
      conversationId = await createConversation(userId, parsed.data.message);
    }
    if (!parsed.data.isRetry) await appendMessage(userId, conversationId, { role: "user", content: parsed.data.message });
  } catch (error) {
    logFailure("conversation_write_user", error);
    persistenceWarning = "This conversation could not be saved. Your request can still be answered.";
    conversationId = undefined;
    context = [];
  }

  try {
    const effectiveMessage = resolveRetryMessage(parsed.data.message, parsed.data.isRetry, context);
    const controller = new AbortController();
    const deadlineAt = Date.now() + QUERY_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
    let execution;
    const progressTimer = onProgress ? setInterval(() => onProgress(queryContext?.activeAgents ?? []), 150) : undefined;
    try {
      execution = await Promise.race([
        withRequestContext(queryContext = { requestId, userId, conversationId, deadlineAt, signal: controller.signal, reservedModelCostUsd: 0, actualModelCostUsd: 0 }, async () => {
          const result = await runOrchestrator(effectiveMessage, userId, context, conversationId, requestId, parsed.data.uiAction);
          return { result, budget: queryBudgetSnapshot() };
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new QueryDeadlineExceededError()), QUERY_TIMEOUT_MS)),
      ]);
    } finally {
      clearTimeout(timer);
      if (progressTimer) clearInterval(progressTimer);
    }
    const { result, budget } = execution;
    console.info("query_complete", JSON.stringify({ requestId, durationMs: QUERY_TIMEOUT_MS - budget.remainingMs, reservedCostUsd: budget.reservedCostUsd, actualCostUsd: budget.actualCostUsd, agents: result.agents, status: result.status }));
    await recordQueryTelemetry({ userId, requestId, conversationId, agents: result.agents, status: result.status, outcome: "success", durationMs: Date.now() - queryStartedAt, reservedCostUsd: budget.reservedCostUsd, actualCostUsd: budget.actualCostUsd, cacheHits: queryContext?.cacheHits, cacheMisses: queryContext?.cacheMisses });
    if (conversationId) {
      try {
        await appendMessage(userId, conversationId, { role: "assistant", content: result.answer });
        await compactConversationContext(userId, conversationId).catch((error) => logFailure("conversation_compaction", error));
      } catch (error) {
        logFailure("conversation_write_assistant", error);
        persistenceWarning = "The answer was generated, but it may not appear in history.";
      }
    }
    const sequence = conversationId && !persistenceWarning ? await latestSequence(userId, conversationId).catch(() => undefined) : undefined;
    return Response.json({ ...result, conversationId, persistenceWarning, sequence });
  } catch (error) {
    logFailure("orchestrator", error);
    Sentry.withScope((scope) => {
      scope.setTag("component", "agent_orchestrator");
      scope.setContext("request", { conversationId: conversationId ?? "unsaved" });
      Sentry.captureException(error);
    });
    const timedOut = error instanceof QueryDeadlineExceededError || (error instanceof DOMException && error.name === "AbortError") || (error instanceof QueryBudgetUnavailableError && error.reason === "time");
    const costLimited = error instanceof QueryBudgetUnavailableError && error.reason === "cost";
    // The daily (or per-call) token budget is a deliberate limit, so say so plainly instead of calling it a temporary failure.
    const tokenLimited = error instanceof ModelBudgetExceededError;
    const errorCode = timedOut ? "QUERY_TIMED_OUT" : costLimited ? "QUERY_COST_LIMIT_REACHED" : tokenLimited ? "MODEL_TOKEN_BUDGET_REACHED" : "ASSISTANT_TEMPORARILY_UNAVAILABLE";
    await recordQueryTelemetry({
      userId,
      requestId,
      conversationId,
      agents: queryContext?.activeAgents ?? [],
      status: "failed",
      outcome: timedOut ? "timeout" : costLimited ? "cost_limited" : "provider_error",
      durationMs: Date.now() - queryStartedAt,
      reservedCostUsd: queryContext?.reservedModelCostUsd ?? 0,
      actualCostUsd: queryContext?.actualModelCostUsd ?? 0,
      errorCode,
      cacheHits: queryContext?.cacheHits,
      cacheMisses: queryContext?.cacheMisses,
    }).catch((telemetryError) => logFailure("query_telemetry", telemetryError));
    return Response.json({
      error: errorCode,
      message: timedOut
        ? "This is taking longer than expected, so I stopped safely. Nothing unconfirmed was changed."
        : costLimited
          ? "I reached this query’s $0.10 processing limit and stopped safely. Try a narrower request."
        : tokenLimited
          ? "I’ve used today’s AI model budget, so anything that needs the model is paused until it resets. Bills, spending totals, receipts and imports that don’t need it still work. To raise the limit, set MODEL_DAILY_TOKEN_BUDGET in .env.local and restart. Nothing was changed."
        : "I couldn’t complete that request right now. Nothing unconfirmed was changed.",
      retryable: !costLimited && !tokenLimited,
      conversationId,
    }, { status: timedOut ? 504 : costLimited || tokenLimited ? 429 : 503 });
  }
}

class QueryDeadlineExceededError extends Error {
  constructor() { super("QUERY_DEADLINE_EXCEEDED"); this.name = "QueryDeadlineExceededError"; }
}

function logFailure(stage: string, error: unknown) {
  const details = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown } : {};
  console.error("chat_request_failed", JSON.stringify({
    stage,
    name: typeof details.name === "string" ? details.name : "unknown",
    message: typeof details.message === "string" ? details.message.slice(0, 300) : "unknown",
    code: typeof details.code === "string" ? details.code : undefined,
    status: typeof details.status === "number" ? details.status : undefined,
  }));
}
