import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock("@/lib/model/claude", () => ({ extractTransactionFromEvidence: mocks.extract }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: vi.fn(async () => undefined) }));
vi.mock("@/lib/workflows/finance-import", () => ({ createFinanceImportApproval: vi.fn() }));

import { prepareReceiptImport } from "./receipt";

it("degrades to a plain message instead of crashing when extraction throws on a malformed or truncated response (found live, R32)", async () => {
  mocks.extract.mockRejectedValue(new SyntaxError("Unterminated string in JSON"));
  const file = new File([new Uint8Array([1, 2, 3])], "receipt.pdf", { type: "application/pdf" });
  const answer = await prepareReceiptImport(file, "u1", "c1");
  expect(answer).toMatch(/couldn’t reliably identify the receipt details/);
  expect(answer).toMatch(/nothing was imported/);
});
