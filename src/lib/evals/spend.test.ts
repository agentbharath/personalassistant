import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_CASES, SpendMeter, capFromEnv, maxCasesFromEnv, runRefusal } from "./spend";

describe("a live run must state a limit and stay small (free)", () => {
  it("refuses to run with no dollar limit", () => {
    expect(runRefusal(10, null, 40)).toMatch(/no spend limit was given/);
    expect(capFromEnv({})).toBeNull();
    expect(capFromEnv({ LIVE_EVAL_MAX_USD: "0" })).toBeNull();
    expect(capFromEnv({ LIVE_EVAL_MAX_USD: "abc" })).toBeNull();
    expect(capFromEnv({ LIVE_EVAL_MAX_USD: "0.25" })).toBe(0.25);
  });

  it("refuses a run larger than the case limit, so a full-set run cannot happen by accident", () => {
    expect(runRefusal(41, 1, 40)).toMatch(/more than the limit of 40/);
    expect(runRefusal(193, 1, DEFAULT_MAX_CASES)).toMatch(/LIVE_EVAL_MAX_CASES=193/);
    expect(runRefusal(40, 1, 40)).toBeNull();
    expect(maxCasesFromEnv({})).toBe(40);
    expect(maxCasesFromEnv({ LIVE_EVAL_MAX_CASES: "200" })).toBe(200);
    expect(maxCasesFromEnv({ LIVE_EVAL_MAX_CASES: "-5" })).toBe(40);
  });
});

describe("spend is measured from what the API reports, and stops before the limit (free)", () => {
  it("prices input and output tokens at Haiku 4.5 rates", () => {
    const meter = new SpendMeter(1);
    meter.record({ input_tokens: 4_000, output_tokens: 300 });
    expect(meter.usd).toBeCloseTo((4_000 * 1 + 300 * 5) / 1_000_000, 8);
    expect(meter.calls).toBe(1);
  });

  it("counts cached tokens too, and tolerates missing usage", () => {
    const meter = new SpendMeter(1);
    meter.record({ input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 2_000 });
    meter.record(undefined);
    expect(meter.usd).toBeCloseTo((100 + 10 * 5 + 1_000 * 1.25 + 2_000 * 0.1) / 1_000_000, 8);
    expect(meter.calls).toBe(2);
  });

  it("stops before a batch that could pass the limit, using the measured cost per call", () => {
    const meter = new SpendMeter(0.10);
    for (let i = 0; i < 8; i += 1) meter.record({ input_tokens: 4_000, output_tokens: 300 }); // about $0.044
    expect(meter.canAfford(8)).toBe(false); // another 8 would take it to about $0.09 with padding, but 8 * 1.3 pushes it over
    expect(new SpendMeter(0.10).canAfford(2)).toBe(true);
    expect(new SpendMeter(0.10).canAfford(20)).toBe(false); // even before any call, an unaffordable batch is refused
  });

  it("reports what was actually spent", () => {
    const meter = new SpendMeter(0.5);
    meter.record({ input_tokens: 1_000_000, output_tokens: 0 });
    expect(meter.summary()).toMatch(/Measured spend: \$1\.0000 for 1 call/);
    expect(meter.summary()).toMatch(/limit \$0\.50/);
  });
});
