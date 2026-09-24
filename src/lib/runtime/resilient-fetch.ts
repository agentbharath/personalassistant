import { reportFailure } from "../observability/report";
import { getRequestContext, remainingRequestMs } from "./request-context";

type ProviderName = "tavily" | "google_calendar" | "google_gmail" | "google_maps" | "google_oauth";

type Circuit = { failures: number; openUntil: number };
const circuits = new Map<string, Circuit>();

export class ProviderCircuitOpenError extends Error {
  constructor(public readonly provider: ProviderName, public readonly retryAt?: number) {
    super(`PROVIDER_CIRCUIT_OPEN:${provider}`);
    this.name = "ProviderCircuitOpenError";
  }
}

export async function resilientFetch(provider: ProviderName, url: string | URL, init: RequestInit = {}, options: { timeoutMs?: number; maxAttempts?: number; circuitKey?: string } = {}) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 3));
  const key = options.circuitKey ? `${provider}:${options.circuitKey}` : provider;
  const circuit = circuits.get(key) ?? { failures: 0, openUntil: 0 };
  if (circuit.openUntil > Date.now()) throw new ProviderCircuitOpenError(provider, circuit.openUntil);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = performance.now();
    try {
      const remainingMs = remainingRequestMs(timeoutMs);
      const requestSignal = getRequestContext()?.signal;
      if (remainingMs <= 0 || requestSignal?.aborted) throw new DOMException("Query deadline exceeded", "AbortError");
      const timeoutSignal = AbortSignal.timeout(remainingMs);
      const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(url, { ...init, signal });
      const retryable = response.status === 429 || response.status >= 500;
      logProviderCall(provider, attempt, response.status, performance.now() - startedAt, retryable ? "retryable_response" : "complete");
      if (!retryable || attempt === maxAttempts) {
        if (response.ok || !retryable) resetCircuit(key);
        else if (response.status !== 429) { recordFailure(provider, key); reportFailure("provider_call_failed", { name: "HttpStatus", status: response.status }, { provider }); }
        return response;
      }
      lastError = new Error(`PROVIDER_${response.status}`);
    } catch (error) {
      // A caller running out of time is not a provider outage, and must not poison the next request's circuit.
      if (getRequestContext()?.signal?.aborted || remainingRequestMs(timeoutMs) <= 0) throw error;
      lastError = error;
      logProviderCall(provider, attempt, undefined, performance.now() - startedAt, "network_error");
      if (attempt === maxAttempts) break;
    }
    if (remainingRequestMs(attempt * 100) <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, attempt * 100));
  }
  recordFailure(provider, key);
  reportFailure("provider_call_failed", lastError, { provider });
  throw lastError instanceof Error ? lastError : new Error("PROVIDER_UNAVAILABLE");
}

function recordFailure(provider: ProviderName, key: string) {
  const current = circuits.get(key) ?? { failures: 0, openUntil: 0 };
  const failures = current.failures + 1;
  circuits.set(key, { failures, openUntil: failures >= 3 ? Date.now() + 30_000 : 0 });
  // Calls to a provider are refused for 30 seconds once it has failed three times in a row, so opening the circuit is worth its own event.
  if (failures === 3) reportFailure("provider_circuit_opened", { name: "CircuitOpened" }, { provider });
}

function resetCircuit(key: string) {
  circuits.delete(key);
}

function logProviderCall(provider: ProviderName, attempt: number, status: number | undefined, durationMs: number, outcome: string) {
  console.info("provider_call", JSON.stringify({ provider, attempt, status, durationMs: Math.round(durationMs), outcome }));
}

export function resetProviderCircuitsForTest() {
  circuits.clear();
}
