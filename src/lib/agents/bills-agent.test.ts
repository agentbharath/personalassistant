import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_LEARNINGS, type Learning } from "@/lib/learning/learnings";
import type { Bill } from "./bills";

const mocks = vi.hoisted(() => ({
  bills: [] as Bill[],
  settled: [] as Array<{ id: string; paidOn: string }>,
  saved: [] as Learning[],
  autopay: [] as string[],
}));

vi.mock("@/lib/tools/finance/bills", () => ({
  listBills: async (_user: string, status?: string) => mocks.bills.filter((bill) => !status || bill.status === status),
  settleBill: async (_user: string, id: string, paidOn: string) => {
    mocks.settled.push({ id, paidOn });
    const bill = mocks.bills.find((item) => item.id === id)!;
    return { bill: { ...bill, status: "paid", paidOn }, duplicate: false, transactionId: "t1" };
  },
}));
vi.mock("@/lib/learning/store", () => ({
  loadLearnings: async () => ({ ...NO_LEARNINGS, autopay: mocks.autopay }),
  saveLearning: async (_user: string, learning: Learning) => { mocks.saved.push(learning); },
}));
vi.mock("@/lib/tools/email/google-gmail", () => ({ searchGmail: async () => [], readGmailMessage: async () => ({}) }));

import { answerBills, outstandingLine, runBillsCommand } from "./bills-agent";

const bill = (over: Partial<Bill> = {}): Bill => ({ id: "b1", merchant: "PG&E", amountMinor: 14630, currency: "USD", category: "utilities", statementDate: "2026-09-17", dueDate: "2099-10-05", status: "outstanding", paidOn: null, ...over });

beforeEach(() => { mocks.bills = []; mocks.settled = []; mocks.saved = []; mocks.autopay = []; });

describe("I paid the bill (R17.5)", () => {
  it("marks the oldest matching outstanding bill paid on the day given", async () => {
    mocks.bills = [bill({ id: "new", statementDate: "2026-10-17" }), bill({ id: "old", statementDate: "2026-09-17" })];
    const answer = await runBillsCommand({ type: "paid", merchant: "PG&E", paidOn: "2026-09-20" }, "u1");
    expect(mocks.settled).toEqual([{ id: "old", paidOn: "2026-09-20" }]);
    expect(answer).toMatch(/Marked your PG&E bill paid: \$146\.30 on Sep 20, 2026\. It now counts as spending\./);
    expect(answer).toMatch(/1 more PG&E bill outstanding/);
  });
  it("matches a merchant written another way", async () => {
    mocks.bills = [bill({ merchant: "Pacific Gas and Electric" })];
    await runBillsCommand({ type: "paid", merchant: "PG&E", paidOn: "2026-09-20" }, "u1");
    expect(mocks.settled).toHaveLength(1);
  });
  it("says so, and settles nothing, when there is no such outstanding bill", async () => {
    mocks.bills = [bill({ status: "paid" })];
    const answer = await runBillsCommand({ type: "paid", merchant: "PG&E", paidOn: null }, "u1");
    expect(mocks.settled).toEqual([]);
    expect(answer).toMatch(/don't have an outstanding PG&E bill/);
  });
});

describe("autopay (R17.6)", () => {
  it("is learned, and settles bills already past their due date", async () => {
    mocks.bills = [bill({ id: "past", dueDate: "2020-01-05" }), bill({ id: "future", dueDate: "2099-01-05" })];
    const answer = await runBillsCommand({ type: "autopay", merchant: "PG&E" }, "u1");
    expect(mocks.saved).toEqual([{ kind: "autopay", merchant: "PG&E" }]);
    expect(mocks.settled.map((item) => item.id)).toEqual(["past"]);
    expect(answer).toMatch(/Got it\. I'll treat PG&E bills as paid on their due date/);
  });
  it("settles autopay bills when bills are listed, and tells the user", async () => {
    mocks.autopay = ["pg&e"];
    mocks.bills = [bill({ dueDate: "2020-01-05" })];
    const answer = await answerBills("u1");
    expect(mocks.settled).toEqual([{ id: "b1", paidOn: "2020-01-05" }]);
    expect(answer).toMatch(/was on autopay, so I counted it as paid/);
  });
});

describe("what the user sees (R17.3, R17.7, R17.8)", () => {
  it("lists outstanding bills with the past-due question", async () => {
    mocks.bills = [bill({ dueDate: "2020-01-05" })];
    const answer = await answerBills("u1");
    expect(answer).toContain("Past due");
    expect(answer).toContain("Did you pay it? Say “I paid the PG&E bill”.");
  });
  it("adds the not-counted line to spending only when something is outstanding", async () => {
    mocks.bills = [bill()];
    expect(await outstandingLine("u1")).toMatch(/^Not counted yet: 1 unpaid bill, \$146\.30 \(PG&E/);
    mocks.bills = [bill({ status: "paid" })];
    expect(await outstandingLine("u1")).toBe("");
  });
});
