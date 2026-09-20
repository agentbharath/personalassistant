import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  userId: string;
  conversationId?: string;
  deadlineAt?: number;
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

export function remainingRequestMs(fallback: number) {
  const deadlineAt = getRequestContext()?.deadlineAt;
  return deadlineAt ? Math.max(0, Math.min(fallback, deadlineAt - Date.now())) : fallback;
}
