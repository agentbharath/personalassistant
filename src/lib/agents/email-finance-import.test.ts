import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(), saveScan: vi.fn(), search: vi.fn(), read: vi.fn(), pick: vi.fn(), approve: vi.fn(), recorded: vi.fn(), duplicate: vi.fn(), extract: vi.fn(), attachment: vi.fn(), statement: vi.fn(), bills: vi.fn(),
}));
vi.mock("@/lib/tools/email/google-gmail", async (original) => ({
  newGmailImportCursor: (await original<typeof import("@/lib/tools/email/google-gmail")>()).newGmailImportCursor,
  searchGmailForImport: mocks.search, searchGmail: vi.fn(), readGmailMessage: mocks.read, readGmailAttachment: mocks.attachment,
  GoogleGmailAccessError: class extends Error {},
}));
vi.mock("@/lib/agents/spending-picker-runtime", () => ({ pickSpendingEmailsForUser: mocks.pick }));
vi.mock("@/lib/model/claude", () => ({ extractTransactionFromEvidence: mocks.extract }));
vi.mock("@/lib/conversations/email-state", () => ({ saveEmailState: vi.fn() }));
vi.mock("@/lib/learning/store", () => ({ loadLearnings: vi.fn(async () => NO_LEARNINGS) }));
vi.mock("@/lib/tools/finance/bills", () => ({ listBills: mocks.bills }));
vi.mock("@/lib/tools/finance/transactions", () => ({ recordedEmailRefs: mocks.recorded, previewDuplicate: mocks.duplicate }));
vi.mock("@/lib/workflows/finance-import", () => ({ createFinanceImportApproval: mocks.approve }));
vi.mock("@/lib/agents/email-interpreter-runtime", () => ({ createInterpretationCache: () => ({ get: async () => null, set: async () => {} }) }));
vi.mock("@/lib/workflows/email-scan", () => ({ acquireEmailScan: mocks.acquire, saveEmailScan: mocks.saveScan, ScanBusyError: class extends Error {}, ScanStoppedError: class extends Error {} }));
import { NO_LEARNINGS } from "@/lib/learning/learnings";
vi.mock("./bill-statement", async (original) => ({ ...await original<typeof import("./bill-statement")>(), extractBillStatement: mocks.statement }));
import { prepareEmailFinanceImport, prepareEmailDuesImport, continueEmailFinanceImport } from "./email-finance-import";

const mail = (index: number) => ({
  id: `m${index}`, threadId: `t${index}`, from: `Shop ${index} <orders@shop${index}.example>`, subject: `Order confirmation #${100000 + index}`,
  date: "Sun, 20 Sep 2026 10:00:00 -0700", receivedAt: 1000 - index, snippet: "Order total: $10.00", text: "Order total: $10.00", attachments: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.acquire.mockImplementation(async (userId, conversationId, data) => ({id:"scan",version:1,userId,conversationId,data}));
  mocks.saveScan.mockResolvedValue(undefined);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-20T19:00:00Z"));
  mocks.search.mockImplementation(async (_user, _query, _limit, _deadline, options) => {
    options.cursor.stage = 4; options.cursor.checked = 45;
    return { messages: Array.from({ length: 45 }, (_, i) => mail(i)), failedCount: 0, truncated: false };
  });
  mocks.pick.mockImplementation(async (_user, emails) => ({ ids: emails.map((email: { id: string }) => email.id), unavailable: false }));
  mocks.read.mockImplementation(async (_user, id) => mail(Number(id.slice(1))));
  mocks.recorded.mockResolvedValue(new Set());
  mocks.duplicate.mockResolvedValue(null);
  mocks.bills.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("import all spending", () => {
  it("processes every candidate beyond the old 15-item and 36-read limits", async () => {
    const result = await prepareEmailFinanceImport("import all my spendings in the last 30 days", "u", "c");
    expect(mocks.search.mock.calls[0][1]).toBe("-in:sent -in:chats -in:drafts -in:spam -in:trash -subject:UPI newer_than:30d");
    expect(mocks.read).toHaveBeenCalledTimes(45);
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.approve.mock.calls[0][2].items).toHaveLength(45);
    expect(result).toContain("$450.00");
    expect(result).not.toContain("Scan incomplete");
  });
  it("discloses missing metadata and capped search results even when nothing was selected", async () => {
    mocks.search.mockResolvedValue({ messages: [], failedCount: 3, truncated: true });
    const result = await prepareEmailFinanceImport("import all my spendings in the last 30 days", "u", "c");
    expect(result).toContain("Scan paused");
    expect(result).toContain("**Continue scan**");
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("does not read already imported emails and removes database duplicates from the total", async () => {
    mocks.search.mockResolvedValue({ messages: [mail(0), mail(1), mail(2)], failedCount: 0, truncated: false });
    mocks.recorded.mockResolvedValue(new Set(["m0"]));
    mocks.duplicate.mockImplementation(async (_user, _candidate, source) => source.externalRef === "m1" ? {} : null);
    await prepareEmailFinanceImport("import all my spendings in the last 30 days", "u", "c");
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.approve.mock.calls[0][2].items.map((item: { source: { externalRef: string } }) => item.source.externalRef)).toEqual(["m2"]);
  });
  it("reports a failed read while retaining successfully extracted purchases", async () => {
    mocks.search.mockResolvedValue({ messages: [mail(0), mail(1)], failedCount: 0, truncated: false });
    mocks.read.mockImplementation(async (_user, id) => { if (id === "m0") throw new Error("unavailable"); return mail(1); });
    const result = await prepareEmailFinanceImport("import all my spendings in the last 30 days", "u", "c");
    expect(mocks.approve.mock.calls[0][2].items).toHaveLength(1);
    expect(result).toContain("known emails remain");
    expect(result).toContain("**Continue scan**");
  });
  it("reads an attached receipt only when the body has no usable total", async () => {
    mocks.search.mockResolvedValue({ messages: [mail(0)], failedCount: 0, truncated: false });
    mocks.read.mockResolvedValue({ ...mail(0), snippet: "See receipt", text: "See receipt", attachments: [{ id: "a1", mimeType: "application/pdf", size: 100 }] });
    mocks.extract.mockResolvedValueOnce({ isTransaction: true, amountMinor: null, missingFields: ["amount"] })
      .mockResolvedValueOnce({ isTransaction: true, amountMinor: 1200, merchant: "Shop", currency: "USD", occurredOn: "2026-09-20", direction: "expense" });
    mocks.attachment.mockResolvedValue({ data: "aGVsbG8", size: 5 });
    await prepareEmailFinanceImport("import all my spendings in the last 30 days", "u", "c");
    expect(mocks.attachment).toHaveBeenCalledWith("u", "m0", "a1");
    expect(mocks.approve.mock.calls[0][2].items[0].candidate.amountMinor).toBe(1200);
  });

  it("does not import an older transaction just because its payment email arrived recently", async () => {
    mocks.search.mockResolvedValue({ messages: [mail(0)], failedCount: 0, truncated: false });
    mocks.read.mockResolvedValue({ ...mail(0), subject: "Payment confirmation" });
    mocks.extract.mockResolvedValue({ isTransaction: true, amountMinor: 1000, merchant: "Shop", currency: "USD", occurredOn: "2026-07-01", direction: "expense" });
    const result = await prepareEmailFinanceImport("import all my spendings in the last 30 days", "u", "c");
    expect(result).toContain("outside the requested window");
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("discloses candidates left unread when the time budget is reached", async () => {
    const started = Date.now();
    mocks.read.mockImplementation(async (_user, id) => {
      vi.mocked(Date.now).mockReturnValue(started + 241_000);
      return mail(Number(id.slice(1)));
    });
    const result = await prepareEmailFinanceImport("import all my spendings in the last 30 days", "u", "c");
    expect(result).toContain("Scan paused");
    expect(result).toContain("39 known emails remain");
    expect(mocks.read.mock.calls.length).toBeLessThan(45);
  });
});


const statement = (over = {}) => ({ isBill: true, amountMinor: 1000, currency: "USD", merchant: "Local Credit Union", statementDate: "2026-09-01", dueOn: "2026-10-05", kind: "credit_card", accountLastFour: "1234", ...over });

describe("email statements for all dues", () => {
  it("uses statement selection and preserves full balance, due date and card transfer direction", async () => {
    mocks.search.mockResolvedValue({ messages: [mail(0)], failedCount: 0, truncated: false });
    mocks.statement.mockResolvedValue(statement());
    const result = await prepareEmailDuesImport("u", "c");
    expect(mocks.pick.mock.calls[0][2]).toBe("bills");
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.approve.mock.calls[0][2].items[0]).toMatchObject({ kind: "bill", dueOn: "2026-10-05", candidate: { amountMinor: 1000, occurredOn: "2026-09-01", direction: "transfer" } });
    expect(result).toContain("not verified live balances");
    expect(result).toContain("Reminders → All dues");
  });
  it("does not revive an older balance when the newest statement is already marked paid", async () => {
    mocks.search.mockResolvedValue({ messages: [mail(0), mail(1)], failedCount: 0, truncated: false });
    mocks.statement.mockImplementation(async (_user, id) => statement({ statementDate: id === "m0" ? "2026-09-01" : "2026-08-01" }));
    mocks.bills.mockResolvedValue([{ merchant: "Local Credit Union", amountMinor: 1000, currency: "USD", statementDate: "2026-09-01", status: "paid", accountLastFour: "1234" }]);
    const result = await prepareEmailDuesImport("u", "c");
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(result).toContain("already recorded");
  });
  it("keeps distinct card accounts and utility bills, while retaining only the latest balance of one card", async () => {
    mocks.search.mockResolvedValue({ messages: [mail(0), mail(1), mail(2), mail(3)], failedCount: 0, truncated: false });
    mocks.statement.mockImplementation(async (_user, id) => statement(id === "m1" ? { statementDate: "2026-08-01" } : id === "m2" ? { accountLastFour: "5678" } : id === "m3" ? { kind: "utility", merchant: "Local Energy", accountLastFour: null } : {}));
    await prepareEmailDuesImport("u", "c");
    expect(mocks.approve.mock.calls[0][2].items).toHaveLength(3);
  });
  it("keeps processing imports after the former 50-second cutoff", async () => {
    const started = Date.now();
    mocks.read.mockImplementation(async (_user, id) => { vi.mocked(Date.now).mockReturnValue(started + 60_000); return mail(Number(id.slice(1))); });
    await prepareEmailFinanceImport("import all my spendings in the last 30 days", "u", "c");
    expect(mocks.approve.mock.calls[0][2].items).toHaveLength(45);
  });
});


describe("UPI exclusion, remittances and card payments", () => {
  it("drops UPI summaries before selection and ignores UPI evidence discovered in the body", async () => {
    mocks.search.mockResolvedValue({ messages: [{ ...mail(0), subject: "UPI/IMPS/MB Transaction Alert" }, mail(1)], failedCount: 0, truncated: false });
    mocks.read.mockResolvedValue({ ...mail(1), text: "Paid via UPI" });
    const result = await prepareEmailFinanceImport("import all my spending in the last 30 days", "u", "c");
    expect(mocks.pick.mock.calls[0][1]).toHaveLength(1);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(result).toContain("UPI transactions are excluded");
  });

  it("reconciles two currencies of one Remitly transfer while preserving different references", async () => {
    const emails = [0,1,2].map((i) => ({...mail(i), from:"Remitly <updates@remitly.com>", subject:"Status Update: transfer to Prasanna Kumar", text:`Reference: ${i === 2 ? "R999999999" : "R123456789"} You sent: 3,000.00 USD Recipient receives: INR 282,780.00`}));
    mocks.search.mockResolvedValue({messages:emails, failedCount:0, truncated:false});
    mocks.read.mockImplementation(async (_user,id) => emails.find(e=>e.id===id));
    mocks.extract.mockResolvedValue({isTransaction:true, amountMinor:28278000, currency:"INR", direction:"transfer", merchant:"Remitly", occurredOn:"2026-09-11"});
    const result=await prepareEmailFinanceImport("import all my spending in the last 30 days", "u", "c");
    const items=mocks.approve.mock.calls[0][2].items;
    expect(items).toHaveLength(2);
    expect(items.map((item: {candidate: {currency:string;amountMinor:number}})=>[item.candidate.currency,item.candidate.amountMinor])).toEqual([["USD",300000],["USD",300000]]);
    expect(result).toContain("**transfer**");
    expect(result).not.toContain("**card payment**");
  });

  it("reads Discover payment confirmations even when the picker misses them", async () => {
    const email={...mail(0), from:"Discover <discover@services.discovercard.com>", subject:"We've received your payment", text:"Payment received $250.00 on September 11, 2026"};
    mocks.search.mockResolvedValue({messages:[email],failedCount:0,truncated:false});
    mocks.read.mockResolvedValue(email);
    mocks.pick.mockResolvedValueOnce({ids:[],unavailable:false});
    mocks.extract.mockResolvedValue({isTransaction:true,amountMinor:25000,currency:"USD",direction:"expense",merchant:"Discover",occurredOn:"2026-09-11"});
    const result=await prepareEmailFinanceImport("import all my spending in the last 30 days", "u", "c");
    expect(mocks.search.mock.calls[0][4]).toMatchObject({prioritizePayments:true});
    expect(mocks.approve.mock.calls[0][2].items[0].candidate).toMatchObject({merchant:"Discover",direction:"transfer",amountMinor:25000});
    expect(result).toContain("**card payment**");
  });
});


describe("durable scan continuation", () => {
  it("resumes only unread candidates and combines results with the saved preview", async () => {
    const started = Date.now();
    mocks.read.mockImplementation(async (_user, id) => {
      vi.mocked(Date.now).mockReturnValue(started + 241000);
      return mail(Number(id.slice(1)));
    });
    await prepareEmailFinanceImport("import all spending last 30 days", "u", "c");
    expect(mocks.approve.mock.calls[0][2].items).toHaveLength(6);
    const first = await mocks.acquire.mock.results[0].value;
    const restarted = structuredClone(first);
    expect(restarted.data.candidates).toHaveLength(39);
    const queries = [...restarted.data.cursor.queries];
    // Simulate a later request/process: restore only the persisted state.
    vi.mocked(Date.now).mockReturnValue(started + 86400000);
    mocks.acquire.mockResolvedValueOnce(restarted);
    mocks.read.mockImplementation(async (_user, id) => mail(Number(id.slice(1))));
    mocks.search.mockClear(); mocks.read.mockClear();
    const reply = await continueEmailFinanceImport("u", "c");
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(39);
    expect(mocks.read.mock.calls.map(call => call[1])).not.toContain("m0");
    expect(mocks.approve.mock.calls.at(-1)?.[2].items).toHaveLength(45);
    expect(restarted.data.cursor.queries).toEqual(queries);
    expect(reply).toContain("Scan complete across all categories");
    expect(reply).not.toContain("**Continue scan**");
    expect(mocks.saveScan).toHaveBeenLastCalledWith(restarted, "completed");
  });

  it("does not call Gmail or replace the pending approval during a saved cooldown", async () => {
    await prepareEmailFinanceImport("import all spending last 30 days", "u", "c");
    const handle = await mocks.acquire.mock.results[0].value;
    handle.data.cursor.stage = 1;
    handle.data.cursor.retryAt = Date.now() + 60000;
    mocks.acquire.mockResolvedValueOnce(structuredClone(handle));
    mocks.search.mockClear(); mocks.read.mockClear(); mocks.approve.mockClear();
    const reply = await continueEmailFinanceImport("u", "c");
    expect(reply).toContain("continue in 60 seconds");
    expect(reply).toContain("review list is preserved");
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("does not start a new search when there is no saved scan", async () => {
    mocks.acquire.mockResolvedValueOnce(null);
    expect(await continueEmailFinanceImport("u", "c")).toContain("No saved scan");
    expect(mocks.search).not.toHaveBeenCalled();
  });
});

it("automatically continues incomplete scans without creating partial approvals", async () => {
  const { withRequestContext } = await import("@/lib/runtime/request-context");
  const context: import("@/lib/runtime/request-context").RequestContext = { requestId: "r", userId: "u", conversationId: "c", automaticScan: true };
  mocks.search.mockImplementation(async (_u, _q, _l, _d, options) => {
    options.cursor.stage = 1; options.cursor.checked = 19;
    return { messages: [mail(0)], failedCount: 0, truncated: true };
  });
  await withRequestContext(context, () => prepareEmailFinanceImport("import all spending last 30 days", "u", "c"));
  expect(context.scanProgress).toMatchObject({ checked: 19, found: 1, canContinue: true });
  expect(mocks.approve).not.toHaveBeenCalled();
  const handle = mocks.saveScan.mock.calls.at(-1)![0];
  mocks.acquire.mockResolvedValue(handle);
  mocks.search.mockImplementation(async (_u, _q, _l, _d, options) => {
    options.cursor.stage = 4;
    return { messages: [], failedCount: 0, truncated: false };
  });
  const result = await withRequestContext(context, () => continueEmailFinanceImport("u", "c"));
  expect(context.scanProgress?.canContinue).toBe(false);
  expect(result).toContain("Review 1 imports");
  expect(mocks.approve).toHaveBeenCalledTimes(1);
});

it("does not let a broken candidate block later records or later search pages", async () => {
  const { withRequestContext } = await import("@/lib/runtime/request-context");
  const context = { requestId: "r", userId: "u", conversationId: "c", automaticScan: true };
  let searches = 0;
  mocks.search.mockImplementation(async (_u, _q, _l, _d, options) => {
    searches++;
    options.cursor.stage = searches === 1 ? 1 : 4;
    options.cursor.checked += 2;
    return { messages: searches === 1 ? [mail(0), mail(1)] : [mail(2)], failedCount: 0 };
  });
  mocks.read.mockImplementation(async (_u, id) => { if (id === "m0") throw new Error("unreadable"); return mail(Number(id.slice(1))); });
  await withRequestContext(context, () => prepareEmailFinanceImport("import all spending last 30 days", "u", "c"));
  const handle = mocks.saveScan.mock.calls.at(-1)![0];
  expect(handle.data.outcomes.m1.kind).toBe("item");
  mocks.acquire.mockResolvedValue(handle);
  await withRequestContext(context, () => continueEmailFinanceImport("u", "c"));
  await withRequestContext(context, () => continueEmailFinanceImport("u", "c"));
  const answer = await withRequestContext(context, () => continueEmailFinanceImport("u", "c"));
  expect(searches).toBe(2);
  expect(answer).toContain("Review 2 imports");
  expect(answer).toContain("couldn’t be read after three attempts");
  expect(mocks.approve).toHaveBeenCalledTimes(1);
});
it("acknowledges a saved server pause without creating a partial approval", async () => {
  const { ScanStoppedError } = await import("@/lib/workflows/email-scan");
  mocks.saveScan.mockImplementationOnce(async handle => { handle.stopped = true; throw new ScanStoppedError(); });
  const answer = await prepareEmailFinanceImport("import all spending last 30 days", "u", "c");
  expect(answer).toContain("Scan paused and progress saved");
  expect(mocks.approve).not.toHaveBeenCalled();
});
