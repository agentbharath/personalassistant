import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: vi.fn(), acquire: vi.fn(), save: vi.fn(), cancel: vi.fn(), complete: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/tools/email/google-gmail", async (original) => ({
  ...(await original<typeof import("@/lib/tools/email/google-gmail")>()),
  searchGmailForImport: mocks.search,
}));
vi.mock("@/lib/workflows/email-scan", () => ({ acquireEmailScan: mocks.acquire, saveEmailScan: mocks.save, cancelEmailScan: mocks.cancel }));
vi.mock("@/lib/runtime/model-runtime", () => ({ callClaude: mocks.complete }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { advanceSenderInventory, classifySenders, hasSenderInventoryInProgress, renderSenderInventory, type ClassifiedSender } from "./sender-inventory";

const message = (from: string, subject: string, date = "2026-01-01") => ({ id: `${from}-${subject}`, threadId: "t", from, subject, date, receivedAt: 1, snippet: "", to: "" });

beforeEach(() => {
  mocks.search.mockReset(); mocks.acquire.mockReset(); mocks.save.mockReset().mockResolvedValue(undefined); mocks.cancel.mockReset().mockResolvedValue(undefined); mocks.complete.mockReset(); mocks.admin.mockReset();
});

describe("the sender inventory scan (R32)", () => {
  it("starts a fresh scan, groups drained messages by sender domain, and marks it done when the search says so", async () => {
    mocks.acquire.mockResolvedValueOnce(null).mockImplementationOnce(async (_u: string, _c: string, initial: unknown) => ({ id: "h", version: 1, userId: "u", conversationId: "c", data: initial }));
    mocks.search.mockImplementation(async (_u, _q, _m, _d, options) => {
      options.cursor.ready.push(message("billing@pge.com", "Your bill is ready"), message("billing@pge.com", "Payment received"), message("news@linkedin.com", "New connections for you"));
      options.cursor.pending = []; options.cursor.stage = options.cursor.queries.length;
      return { messages: options.cursor.ready, truncated: false, failedCount: 0, unreadCount: 0, failureReasons: [] };
    });
    const result = await advanceSenderInventory("u1", "c1", "2022-01-01");
    expect(result.done).toBe(true);
    expect(result.scannedCount).toBe(3);
    expect(result.senders).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "pge.com", count: 2 }),
      expect.objectContaining({ domain: "linkedin.com", count: 1 }),
    ]));
    expect(mocks.save).toHaveBeenLastCalledWith(expect.anything(), "completed", "sender_inventory");
    expect(mocks.cancel).toHaveBeenCalledWith("u1", "c1", "sender_inventory");
  });

  it("resumes an existing checkpoint instead of starting over, ignoring the since date passed on a continuation call", async () => {
    const existingData = { since: "2022-01-01", cursor: { queries: ["q"], stage: 1, pageLoaded: false, pending: [], seen: ["already-seen"], ready: [] as ReturnType<typeof message>[], checked: 5, unavailable: 0, retryAt: 0 }, senders: { "pge.com": { domain: "pge.com", count: 3, subjects: ["Bill"], lastSeen: "2022-02-01" } }, scannedCount: 5 };
    mocks.acquire.mockResolvedValueOnce({ id: "h", version: 2, userId: "u", conversationId: "c", data: existingData });
    mocks.search.mockImplementation(async (_u, _q, _m, _d, options) => {
      options.cursor.ready.push(message("amazon.com", "Your order shipped"));
      return { messages: options.cursor.ready, truncated: true, failedCount: 0, unreadCount: 0, failureReasons: [] };
    });
    const result = await advanceSenderInventory("u1", "c1", "irrelevant-since-resuming");
    expect(result.done).toBe(false); // still truncated
    expect(result.scannedCount).toBe(6); // 5 already scanned + 1 newly drained
    expect(result.senders.find((s) => s.domain === "pge.com")?.count).toBe(3); // carried over from the resumed checkpoint
    expect(result.senders.find((s) => s.domain === "amazon.com")?.count).toBe(1);
    expect(mocks.acquire).toHaveBeenCalledTimes(1); // never tried to create a second, fresh checkpoint
  });

  it("checks for an in-progress scan without claiming its lease", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "row" }, error: null });
    mocks.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ in: () => ({ maybeSingle }) }) }) }) }) }) });
    expect(await hasSenderInventoryInProgress("u1", "c1")).toBe(true);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
});

describe("sender classification (R32)", () => {
  const sender = (domain: string, subjects: string[]) => ({ domain, count: subjects.length, subjects, lastSeen: "2022-01-01" });

  it("labels senders from their sample subjects, batched", async () => {
    mocks.complete.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ senders: [{ domain: "pge.com", classification: "transactional" }, { domain: "linkedin.com", classification: "none" }] }) }] });
    const result = await classifySenders([sender("pge.com", ["Your bill"]), sender("linkedin.com", ["New connections"])], "u1");
    expect(result).toEqual([
      { ...sender("pge.com", ["Your bill"]), classification: "transactional" },
      { ...sender("linkedin.com", ["New connections"]), classification: "none" },
    ]);
  });

  it("degrades a failed or malformed batch to \"none\" for that batch, rather than crashing the whole inventory (R32)", async () => {
    mocks.complete.mockRejectedValue(new Error("down"));
    const result = await classifySenders([sender("pge.com", ["Your bill"])], "u1");
    expect(result).toEqual([{ ...sender("pge.com", ["Your bill"]), classification: "none" }]);
  });

  it("batches at most 20 senders per call", async () => {
    mocks.complete.mockImplementation(async (_op, params) => {
      const domains = (JSON.parse(params.messages[0].content) as Array<{ domain: string }>).map((s) => s.domain);
      return { content: [{ type: "text", text: JSON.stringify({ senders: domains.map((domain) => ({ domain, classification: "none" })) }) }] };
    });
    const senders = Array.from({ length: 25 }, (_, i) => sender(`sender${i}.com`, ["x"]));
    await classifySenders(senders, "u1");
    expect(mocks.complete).toHaveBeenCalledTimes(2);
  });
});

describe("rendering the sender review, in code (R32)", () => {
  const classified = (domain: string, classification: ClassifiedSender["classification"], count = 3): ClassifiedSender => ({ domain, count, subjects: [`sample from ${domain}`], lastSeen: "2022-01-01", classification });

  it("groups by classification so the owner can scan transactional vs. not in one pass", () => {
    const text = renderSenderInventory([classified("pge.com", "transactional"), classified("linkedin.com", "none"), classified("target.com", "mixed")], true, 500);
    expect(text).toContain("Scanned 500 emails, 3 distinct senders.");
    expect(text).toContain("**Transactional** (1)");
    expect(text).toContain("**Mixed** (1)");
    expect(text).toContain("**Not financial** (1)");
    expect(text).toContain("pge.com");
  });

  it("tells the owner to say \"continue\" when the scan isn't done yet", () => {
    expect(renderSenderInventory([classified("pge.com", "transactional")], false, 200)).toMatch(/still going.*"continue"/s);
  });
});
