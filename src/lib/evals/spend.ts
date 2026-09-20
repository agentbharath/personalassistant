/**
 * Spend safety for live evaluations (R21). Two hard rules, both enforced by code rather than by promise:
 *  1. A run must state a dollar limit (LIVE_EVAL_MAX_USD). Spend is MEASURED from the token counts the API returns, and the run stops
 *     before a batch that could pass the limit.
 *  2. A run may not send more than a small number of cases (LIVE_EVAL_MAX_CASES, default 40). A full-set run is therefore something that
 *     has to be asked for on purpose, with the number written out; it can never happen because a prompt version changed.
 * Estimates (`estimateLiveCost`) are only estimates and are labelled as such. The measured total is what a run reports.
 */

/** Claude Haiku 4.5 list prices, USD per million tokens. */
export const RATES = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };
export const DEFAULT_MAX_CASES = 40;

export type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };

export function capFromEnv(env: Record<string, string | undefined> = process.env): number | null {
  const value = Number(env.LIVE_EVAL_MAX_USD);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function maxCasesFromEnv(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.LIVE_EVAL_MAX_CASES);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_CASES;
}

/** Why a run must not start, or null when it may. Checked before any model call. */
export function runRefusal(cases: number, capUsd: number | null, maxCases: number): string | null {
  if (capUsd === null) return "Refusing to run: no spend limit was given. Set LIVE_EVAL_MAX_USD to the most you are willing to spend on this run, for example LIVE_EVAL_MAX_USD=0.25.";
  if (cases > maxCases) return `Refusing to run: this would send ${cases} cases, more than the limit of ${maxCases} per run. Nothing was called. If a run this large is really wanted, say so on purpose with LIVE_EVAL_MAX_CASES=${cases}; otherwise narrow it to the cases that changed.`;
  return null;
}

export class SpendMeter {
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  cacheWriteTokens = 0;
  cacheReadTokens = 0;
  constructor(readonly capUsd: number) {}

  /** Money spent so far, from the token counts the API reported. */
  get usd() {
    return (this.inputTokens * RATES.input + this.outputTokens * RATES.output + this.cacheWriteTokens * RATES.cacheWrite + this.cacheReadTokens * RATES.cacheRead) / 1_000_000;
  }

  record(usage: Usage | undefined | null) {
    this.calls += 1;
    this.inputTokens += usage?.input_tokens ?? 0;
    this.outputTokens += usage?.output_tokens ?? 0;
    this.cacheWriteTokens += usage?.cache_creation_input_tokens ?? 0;
    this.cacheReadTokens += usage?.cache_read_input_tokens ?? 0;
  }

  /** Whether another batch may start: measured spend plus a padded estimate of the batch must stay under the limit. */
  canAfford(batchSize: number, fallbackPerCallUsd = 0.01) {
    const perCall = this.calls > 0 ? this.usd / this.calls : fallbackPerCallUsd;
    return this.usd + batchSize * perCall * 1.3 <= this.capUsd;
  }

  summary() {
    return `Measured spend: $${this.usd.toFixed(4)} for ${this.calls} call${this.calls === 1 ? "" : "s"} (${this.inputTokens} input and ${this.outputTokens} output tokens), limit $${this.capUsd.toFixed(2)}.`;
  }
}
