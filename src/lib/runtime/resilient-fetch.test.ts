import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderCircuitOpenError, resetProviderCircuitsForTest, resilientFetch } from "./resilient-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCircuitsForTest();
});

describe("resilient provider calls", () => {
  it("retries a transient server failure once", async () => {
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", providerFetch);
    const response = await resilientFetch("tavily", "https://example.test", {}, { maxAttempts: 2 });
    expect(response.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent client error", async () => {
    const providerFetch = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", providerFetch);
    const response = await resilientFetch("google_calendar", "https://example.test", {}, { maxAttempts: 2 });
    expect(response.status).toBe(403);
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it("opens the circuit after repeated terminal failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    for (let index = 0; index < 3; index += 1) await expect(resilientFetch("tavily", "https://example.test", {}, { maxAttempts: 1 })).rejects.toThrow("network down");
    await expect(resilientFetch("tavily", "https://example.test", {}, { maxAttempts: 1 })).rejects.toBeInstanceOf(ProviderCircuitOpenError);
  });
});
