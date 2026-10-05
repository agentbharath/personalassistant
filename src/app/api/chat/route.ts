import { requestEmailScanStop } from "@/lib/workflows/email-scan";
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
import { after } from "next/server";
import { writeMemoriesFromMessage } from "@/lib/memory/extractor-runtime";

/** Normal queries stop at 20 seconds; news may extend to 60 seconds, bulk imports to 270, leaving time to save the answer. */
export const maxDuration = 300;

const QUERY_TIMEOUT_MS = 20_000;

const requestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  conversationId: z.string().uuid().optional(),
  automaticContinuation: z.boolean().optional().default(false),
  isRetry: z.boolean().optional().default(false),
  /** The Confirm or Cancel button on an approval card: a fixed value that needs no interpretation (R20.5). */
  uiAction: z.enum(["confirm", "cancel", "continue_scan", "pause_scan"]).optional(),
}).refine(value => !value.automaticContinuation || (Boolean(value.conversationId) && value.uiAction === "continue_scan"), { message: "Automatic continuation requires a saved scan conversation" }).refine((value) => !value.isRetry || Boolean(value.conversationId), { message: "Retry requires an existing conversation" });

/**
 * Clients that accept NDJSON get progress lines while the answer is worked out, then one final line with the result.
 * Progress reports which agents are running (real state, not a timer). Everything else about the request is unchanged.
 */
export async function POST(request: Request) {
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) return handle(request);
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      let disconnected = false;
      const send = (line: unknown) => { if (disconnected) return; try { controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)); } catch { disconnected = true; } };
      let last = "";
      let lastSentAt = Date.now();
      const onProgress = (agents: string[], scan?: RequestContext["scanProgress"]) => {
        const key = JSON.stringify([agents, scan]);
        if (key !== last || Date.now() - lastSentAt >= 10_000) { last = key; lastSentAt = Date.now(); send({ type: "progress", agents, scan }); }
      };
      send({ type: "progress", agents: [] });
      try {
        const response = await handle(request, onProgress);
        send({ type: "result", status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) });
      } catch {
        send({ type: "result", status: 500, body: { message: "I couldn’t complete that request right now. Nothing unconfirmed was changed.", retryable: true } });
      }
      if (!disconnected) controller.close();
    },
  }), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

async function handle(request: Request, onProgress?: (agents: string[], scan?: RequestContext["scanProgress"]) => void): Promise<Response> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });

  if (parsed.data.uiAction === "pause_scan" && !parsed.data.conversationId) return Response.json({ error: "CONVERSATION_REQUIRED" }, { status: 400 });
  let conversationId = parsed.data.conversationId;
  let context: { role: "user" | "assistant"; content: string }[] = [];
  let persistenceWarning: string | undefined;
  const requestId = randomUUID();
  const queryStartedAt = Date.now();
  let queryContext: RequestContext | undefined;
  let effectiveMessage = parsed.data.message;
  let writeBackgroundMemory = false;

  try {
    if (conversationId) {
      const conversation = await getConversation(userId, conversationId);
      if (!conversation) return Response.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
      context = conversation.contextMessages;
      if (parsed.data.uiAction === "pause_scan") {
        await requestEmailScanStop(userId, conversationId);
        return Response.json({ pausing: true, conversationId });
      }
    } else {
      conversationId = await createConversation(userId, parsed.data.message);
    }
    if (!parsed.data.automaticContinuation) await appendMessage(userId, conversationId, { role: "user", content: resolveRetryMessage(parsed.data.message, parsed.data.isRetry, context) });
  } catch (error) {
    logFailure("conversation_write_user", error);
    if (parsed.data.uiAction === "pause_scan") return Response.json({ error: "PAUSE_NOT_SAVED" }, { status: 503 });
    // Never interpret a follow-up without its saved context, or execute an unrecorded turn.
    return Response.json({ message: "I couldn’t load or save this chat right now. I haven’t processed your request. Please try again.", retryable: true }, { status: 503 });
  }

  try {
    effectiveMessage = resolveRetryMessage(parsed.data.message, parsed.data.isRetry, context);
    // R.memory: the background writer only ever sees the person's own typed words, on a real message (never a button click or an
    // automatic scan ping), and runs after the response is already on its way, so it adds no latency and a failure never surfaces here.
    // Scheduled once we know the router's own operation, below — never for memory_remember/memory_forget: an explicit "remember that..."
    // already handled memory deliberately in the same turn, and independently re-reading the same message here had been inferring an
    // extra, unwanted fact from it (found live) — a duplicate the person never asked for, not a second opinion worth having.
    writeBackgroundMemory = !parsed.data.uiAction && !parsed.data.automaticContinuation;
    const controller = new AbortController();
    const deadlineAt = Date.now() + QUERY_TIMEOUT_MS;
    // One timer that follows the request's deadline, which a long job (an import sweep) may extend while it runs.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      const check = () => {
        const left = (queryContext?.deadlineAt ?? deadlineAt) - Date.now();
        if (left <= 0) { controller.abort(); reject(new QueryDeadlineExceededError()); return; }
        timer = setTimeout(check, left);
      };
      timer = setTimeout(check, QUERY_TIMEOUT_MS);
    });
    let execution;
    const progressTimer = onProgress ? setInterval(() => onProgress(queryContext?.activeAgents ?? [], queryContext?.scanProgress), 150) : undefined;
    try {
      execution = await Promise.race([
        withRequestContext(queryContext = { automaticScan: true, requestId, userId, conversationId, startedAt: queryStartedAt, deadlineAt, signal: controller.signal, reservedModelCostUsd: 0, actualModelCostUsd: 0 }, async () => {
          const result = await runOrchestrator(effectiveMessage, userId, context, conversationId, requestId, parsed.data.uiAction === "pause_scan" ? undefined : parsed.data.uiAction);
          return { result, budget: queryBudgetSnapshot() };
        }),
        expiry,
      ]);
    } finally {
      clearTimeout(timer);
      if (progressTimer) clearInterval(progressTimer);
    }
    const { result, budget } = execution;
    if (writeBackgroundMemory && result.operation !== "memory_remember" && result.operation !== "memory_forget") after(() => writeMemoriesFromMessage(userId, effectiveMessage));
    if (queryContext?.contextPersistenceFailed) result.answer += "\n\nI couldn’t save this result list’s references. The answer remains in chat, but referring to its items later may require another search.";
    console.info("query_complete", JSON.stringify({ requestId, durationMs: Date.now() - queryStartedAt, reservedCostUsd: budget.reservedCostUsd, actualCostUsd: budget.actualCostUsd, agents: result.agents, status: result.status }));
    await recordQueryTelemetry({ userId, requestId, conversationId, agents: result.agents, status: result.status, outcome: "success", durationMs: Date.now() - queryStartedAt, reservedCostUsd: budget.reservedCostUsd, actualCostUsd: budget.actualCostUsd, cacheHits: queryContext?.cacheHits, cacheMisses: queryContext?.cacheMisses });
    if (conversationId && !(parsed.data.automaticContinuation && queryContext?.scanProgress?.canContinue)) {
      try {
        await appendMessage(userId, conversationId, { role: "assistant", content: result.answer, choices: result.choices });
        await compactConversationContext(userId, conversationId).catch((error) => logFailure("conversation_compaction", error));
      } catch (error) {
        logFailure("conversation_write_assistant", error);
        persistenceWarning = "The answer was generated, but it may not appear in history.";
      }
    }
    const sequence = conversationId && !persistenceWarning ? await latestSequence(userId, conversationId).catch(() => undefined) : undefined;
    return Response.json({ ...result, conversationId, persistenceWarning, sequence, scan: queryContext?.scanProgress });
  } catch (error) {
    // The operation was never decided (or never reached), so there is no memory_remember/memory_forget to defer to: fall back to the old,
    // unconditional behavior rather than losing a real message's memory write to an unrelated failure elsewhere in the request.
    if (writeBackgroundMemory) after(() => writeMemoriesFromMessage(userId, effectiveMessage));
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
    const failure = {
      error: errorCode,
      message: timedOut
        ? "This is taking longer than expected, so I stopped safely. Nothing unconfirmed was changed."
        : costLimited
          ? `I reached this query’s $${(queryContext?.costLimitUsd ?? 0.10).toFixed(2)} processing limit and stopped safely. Try a narrower request.`
        : tokenLimited
          ? "That request would need more from the AI model than a single call is allowed to use. Nothing was changed; try asking in a smaller step. (If a daily budget is set with MODEL_DAILY_TOKEN_BUDGET, that can also cause this until it resets.)"
        : "I couldn’t complete that request right now. Nothing unconfirmed was changed.",
      retryable: !costLimited && !tokenLimited,
      conversationId,
    };
    let failureSequence: string | undefined;
    let failurePersistenceWarning: string | undefined;
    if (conversationId) {
      try {
        await appendMessage(userId, conversationId, { role: "assistant", content: failure.message, notice: true, retryable: failure.retryable });
        failureSequence = await latestSequence(userId, conversationId).catch(() => undefined);
      } catch (saveError) {
        logFailure("conversation_write_failure", saveError);
        failurePersistenceWarning = "This notice couldn’t be saved to chat history.";
      }
    }
    return Response.json({ ...failure, sequence: failureSequence, persistenceWarning: failurePersistenceWarning }, { status: timedOut ? 504 : costLimited || tokenLimited ? 429 : 503 });
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
