import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: mocks.create }; } }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { ModelBudgetExceededError, QueryCostLimitExceededError, callClaude } from "./model-runtime";
import { withRequestContext } from "./request-context";

beforeEach(() => {
  mocks.create.mockReset();
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.MODEL_MAX_TOKENS_PER_CALL;
  delete process.env.QUERY_MAX_COST_USD;
  delete process.env.MODEL_DAILY_TOKEN_BUDGET;
  delete process.env.ANTHROPIC_HIGH_MODEL;
});

describe("model runtime budget", () => {
  it("rejects a request before the provider call when its token ceiling is exceeded", async () => {
    process.env.MODEL_MAX_TOKENS_PER_CALL = "10";
    await expect(callClaude("test", {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      messages: [{ role: "user", content: "hello" }],
    })).rejects.toBeInstanceOf(ModelBudgetExceededError);
  });

  it("never sends `temperature` to a model that rejects it, once the model the tier resolves to actually changes (R32)", async () => {
    // Confirmed directly against the API: claude-sonnet-5 and claude-opus-5 both 400 on any request that sets `temperature` at all.
    // A caller always asks with `temperature: 0` for determinism; whether that field survives depends only on which model the tier
    // resolved to, decided here, not by each of the many call sites remembering to check for themselves.
    process.env.ANTHROPIC_HIGH_MODEL = "claude-opus-5";
    mocks.create.mockResolvedValue({ usage: { input_tokens: 10, output_tokens: 1 }, content: [] });
    await withRequestContext({ requestId: "r", userId: "u", modelPreference: "high" }, () => callClaude("test", {
      model: "claude-haiku-4-5-20251001", max_tokens: 10, temperature: 0, messages: [{ role: "user", content: "hi" }],
    }));
    expect(mocks.create.mock.calls[0][0].model).toBe("claude-opus-5");
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("temperature");
  });

  it("gives a model that isn't Haiku a longer default timeout, without a caller having to ask (found live, R32, twice)", async () => {
    // The default itself follows the model, not a flat number: found live once in the trip planner's own calls, then again in ordinary
    // web search — two unrelated call sites forgetting to raise it individually was the actual defect, not either call site itself.
    process.env.ANTHROPIC_HIGH_MODEL = "claude-opus-5";
    mocks.create.mockResolvedValue({ usage: { input_tokens: 10, output_tokens: 1 }, content: [] });
    await withRequestContext({ requestId: "r", userId: "u", modelPreference: "high" }, () => callClaude("test", {
      model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "hi" }],
    }));
    expect(mocks.create.mock.calls[0][1].timeout).toBe(30_000);

    mocks.create.mockClear();
    await callClaude("test", { model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
    expect(mocks.create.mock.calls[0][1].timeout).toBe(10_000);
  });

  it("rejects a model call before the provider when the per-query dollar ceiling would be exceeded", async () => {
    process.env.QUERY_MAX_COST_USD = "0.000001";
    await expect(withRequestContext({ requestId: "request", userId: "user", reservedModelCostUsd: 0 }, () => callClaude("test", {
      model: "claude-opus-4-1",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    }))).rejects.toBeInstanceOf(QueryCostLimitExceededError);
  });
});

describe("model calls made outside a chat request (free)", () => {
  const params = { model: "claude-haiku-4-5-20251001", max_tokens: 100, messages: [{ role: "user" as const, content: "hello" }] };

  it("count against the user: the daily token budget, the usage record, and a real cost in the log", async () => {
    mocks.create.mockResolvedValue({ usage: { input_tokens: 1_000_000, output_tokens: 0 }, content: [] });
    await callClaude("reply_needed", params, { userId: "user-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("reserve_model_tokens", expect.objectContaining({ p_user_id: "user-1" }));
    expect(mocks.rpc).toHaveBeenCalledWith("record_model_usage", expect.objectContaining({ p_user_id: "user-1", p_operation: "reply_needed", p_input_tokens: 1_000_000 }));
    const logged = (console.info as ReturnType<typeof vi.fn>).mock.calls.find((call) => call[0] === "model_call");
    expect(JSON.parse(logged![1]).actualCostUsd).toBeCloseTo(1, 4); // $1 per million input tokens, not $0
  });

  it("stop when the user's daily token budget is used up", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(callClaude("reply_needed", params, { userId: "user-1" })).rejects.toBeInstanceOf(ModelBudgetExceededError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("MODEL_DAILY_TOKEN_BUDGET=0 means no daily cap: the reservation call is skipped, but usage is still recorded", async () => {
    process.env.MODEL_DAILY_TOKEN_BUDGET = "0";
    mocks.create.mockResolvedValue({ usage: { input_tokens: 50_000_000, output_tokens: 0 }, content: [] });
    await callClaude("reply_needed", params, { userId: "user-1" });
    expect(mocks.rpc).not.toHaveBeenCalledWith("reserve_model_tokens", expect.anything());
    expect(mocks.rpc).toHaveBeenCalledWith("record_model_usage", expect.objectContaining({ p_user_id: "user-1" }));
  });

  it("are not saved when nobody is named (a script or a test)", async () => {
    mocks.create.mockResolvedValue({ usage: { input_tokens: 10, output_tokens: 1 }, content: [] });
    await callClaude("script", params);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("report a failure that used up its attempts, without the provider's message", async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error("secret text alice@example.com"), { status: 400 }));
    await expect(callClaude("reply_needed", params, { userId: "user-1" })).rejects.toThrow();
    const reported = (console.warn as ReturnType<typeof vi.fn>).mock.calls.find((call) => call[0] === "model_call_failed");
    expect(reported![1]).toContain('"operation":"reply_needed"');
    expect(reported![1]).not.toContain("alice@example.com");
  });
});

it("allows bounded background timeouts while honoring the request deadline",async()=>{
 mocks.create.mockResolvedValue({content:[],usage:{input_tokens:1,output_tokens:1}});
 await withRequestContext({userId:"u",requestId:"r",deadlineAt:Date.now()+5000,costLimitUsd:1},()=>callClaude("spending_pick",{model:"claude-haiku-4-5-20251001",max_tokens:10,messages:[{role:"user",content:"classify"}]},{timeoutMs:30000}));
 expect(mocks.create.mock.calls[0][1].timeout).toBeLessThanOrEqual(5000);
 expect(mocks.create.mock.calls[0][1].timeout).toBeGreaterThan(0);
});
