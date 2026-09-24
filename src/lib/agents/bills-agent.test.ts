import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_LEARNINGS, type Learning } from "@/lib/learning/learnings";
import type { Bill } from "./bills";

const mocks = vi.hoisted(() => ({
  bills: [] as Bill[],
  settled: [] as Array<{ id: string; paidOn: string }>,
  saved: [] as Learning[],
  autopay: [] as string[],
  importDues: vi.fn(),
  lastChecked: null as Date | null,
  recorded: [] as Date[],
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

vi.mock("./email-finance-import", () => ({ prepareEmailDuesImport: mocks.importDues }));
vi.mock("@/lib/tools/finance/sync-state", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tools/finance/sync-state")>("@/lib/tools/finance/sync-state");
  return {
    ...actual,
    lastBillsEmailCheck: async () => mocks.lastChecked,
    recordBillsEmailCheck: async (_user: string, when: Date) => { mocks.recorded.push(when); },
  };
});
import { answerBills, outstandingLine, runBillsCommand } from "./bills-agent";

const bill = (over: Partial<Bill> = {}): Bill => ({ id: "b1", merchant: "PG&E", amountMinor: 14630, currency: "USD", category: "utilities", statementDate: "2026-09-17", dueDate: "2099-10-05", status: "outstanding", paidOn: null, ...over });

beforeEach(() => { mocks.bills = []; mocks.settled = []; mocks.saved = []; mocks.autopay = []; mocks.lastChecked = null; mocks.recorded = []; mocks.importDues.mockReset(); });

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


describe("dues from saved bills and email", () => {
  it("shows saved bills together with the statement review and uses the requested window", async () => {
    mocks.bills = [bill()];
    mocks.importDues.mockResolvedValue("Review email statements. Choose **Confirm**.");
    const answer = await answerBills("u1", "c1", 30);
    expect(answer).toContain("Saved dues");
    expect(answer).toContain("PG&E");
    expect(answer).toContain("Review email statements");
    expect(mocks.importDues).toHaveBeenCalledWith("u1", "c1", 30);
  });
  it("keeps saved dues visible if the mailbox scan fails", async () => {
    mocks.bills = [bill()];
    mocks.importDues.mockRejectedValue(new Error("mail unavailable"));
    const answer = await answerBills("u1", "c1");
    expect(answer).toContain("PG&E");
    expect(answer).toContain("email coverage is incomplete");
  });
  it("records when the sweep ran, so a repeat ask right after skips the sweep and just shows saved dues", async () => {
    mocks.bills = [bill()];
    mocks.importDues.mockResolvedValue("Review email statements. Choose **Confirm**.");
    await answerBills("u1", "c1");
    expect(mocks.recorded).toHaveLength(1);
    mocks.lastChecked = mocks.recorded[0];
    mocks.importDues.mockClear();
    const answer = await answerBills("u1", "c1");
    expect(mocks.importDues).not.toHaveBeenCalled();
    expect(answer).toContain("PG&E");
    expect(answer).toMatch(/Checked your email for new statements (just now|.* ago)/);
  });
  it("sweeps again once enough time has passed since the last check", async () => {
    mocks.bills = [bill()];
    mocks.lastChecked = new Date(Date.now() - 7 * 60 * 60 * 1000);
    mocks.importDues.mockResolvedValue("Review email statements. Choose **Confirm**.");
    const answer = await answerBills("u1", "c1");
    expect(mocks.importDues).toHaveBeenCalled();
    expect(answer).toContain("Review email statements");
  });
  it("sweeps anyway when asked to, even right after a check", async () => {
    mocks.bills = [bill()];
    mocks.lastChecked = new Date();
    mocks.importDues.mockResolvedValue("Review email statements. Choose **Confirm**.");
    const answer = await answerBills("u1", "c1", 90, true);
    expect(mocks.importDues).toHaveBeenCalled();
    expect(answer).toContain("Review email statements");
  });
});
