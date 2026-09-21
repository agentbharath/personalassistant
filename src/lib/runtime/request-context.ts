import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  userId: string;
  conversationId?: string;
  startedAt?: number;
  deadlineAt?: number;
  /** Overrides the default per-request cost cap, for the few requests that legitimately need more (an import sweep). */
  costLimitUsd?: number;
  signal?: AbortSignal;
  reservedModelCostUsd?: number;
  actualModelCostUsd?: number;
  modelPreference?: "fast" | "balanced" | "high";
  activeAgents?: string[];
  cacheHits?: number;
  cacheMisses?: number;
};
const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(context: RequestContext, task: () => Promise<T>) {
  return storage.run(context, task);
}

export function getRequestContext() {
  return storage.getStore();
}

/** Gives the running request more time and a larger cost cap. Only work that is known to be long, and that stops safely, asks for this. */
export function extendRequestBudget(totalMs: number, costLimitUsd: number) {
  const context = getRequestContext();
  if (!context) return;
  context.deadlineAt = (context.startedAt ?? Date.now()) + totalMs;
  context.costLimitUsd = costLimitUsd;
}

export function remainingRequestMs(fallback: number) {
  const deadlineAt = getRequestContext()?.deadlineAt;
  return deadlineAt ? Math.max(0, Math.min(fallback, deadlineAt - Date.now())) : fallback;
}
