import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock("@/lib/model/claude", () => ({ extractTransaction: mocks.extract }));
vi.mock("./finance-query", () => ({ answerFinanceQuery: vi.fn() }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: vi.fn(async () => undefined) }));
vi.mock("@/lib/tools/finance/transactions", () => ({ createTransactionCandidate: vi.fn() }));

import { answerFinance } from "./finance";

it("degrades to a plain message instead of crashing when extraction throws on a malformed or truncated response (found live, R32)", async () => {
  mocks.extract.mockRejectedValue(new SyntaxError("Unterminated string in JSON"));
  const answer = await answerFinance("I spent $24.50 at Curry Point today", "u1", "record");
  expect(answer).toMatch(/couldn’t process that right now/);
});
