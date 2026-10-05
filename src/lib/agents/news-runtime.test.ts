import { beforeEach, expect, it, vi } from "vitest";
import { withRequestContext, type RequestContext } from "@/lib/runtime/request-context";
const mocks = vi.hoisted(() => ({ complete: vi.fn(), news: vi.fn() }));
vi.mock("@/lib/runtime/model-runtime", () => ({ callClaude: mocks.complete }));
vi.mock("./news", () => ({ answerNews: mocks.news }));
import { answerNewsForUser } from "./news-runtime";
beforeEach(() => {
  mocks.news.mockReset().mockImplementation(async (_query, complete) => { await complete({ max_tokens: 1800 }); return "News"; });
  mocks.complete.mockReset().mockResolvedValue({});
});
it("gives actual news wiring 60 seconds without raising the cost cap or changing model preference", async () => {
  const startedAt = Date.now();
  const context: RequestContext = { requestId: "r", userId: "u", startedAt, deadlineAt: startedAt + 20_000, costLimitUsd: 0.10, modelPreference: "balanced" };
  await withRequestContext(context, () => answerNewsForUser("sports news", "u"));
  expect(context).toMatchObject({ deadlineAt: startedAt + 60_000, costLimitUsd: 0.10, modelPreference: "balanced" });
  expect(mocks.complete).toHaveBeenCalledWith("news_digest", expect.any(Object), { userId: "u", timeoutMs: 30_000 });
});
it("does not shorten an existing deadline", async () => {
  const deadlineAt = Date.now() + 120_000;
  const context: RequestContext = { requestId: "r", userId: "u", startedAt: Date.now(), deadlineAt };
  await withRequestContext(context, () => answerNewsForUser("sports news", "u"));
  expect(context.deadlineAt).toBe(deadlineAt);
});
