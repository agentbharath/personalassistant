import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callClaude: vi.fn(), runTripPlan: vi.fn() }));
vi.mock("@/lib/runtime/model-runtime", () => ({ callClaude: mocks.callClaude }));
vi.mock("./trip-planner", () => ({ runTripPlan: mocks.runTripPlan }));

import { runTripPlanForUser } from "./trip-planner-runtime";

it("gives the real model calls a timeout long enough for their real workload, not callClaude's 10s default for a short call (found live, R32)", async () => {
  mocks.runTripPlan.mockImplementation((_d: string, _t: string, _u: string, _c: unknown, deps: { complete: (op: string, params: unknown) => unknown }) => deps.complete("trip_candidate_extraction", { model: "m", max_tokens: 1, messages: [] }));
  mocks.callClaude.mockResolvedValue({ content: [] });
  await runTripPlanForUser("Colorado", "this upcoming Thanksgiving weekend", "u1");
  expect(mocks.callClaude).toHaveBeenCalledWith("trip_candidate_extraction", expect.anything(), { userId: "u1", timeoutMs: 30_000 });
});
