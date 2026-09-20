import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queues: {} as Record<string, unknown[]>, writes: [] as Array<{ table: string; values: unknown }> }));
function builder(table: string) {
  const proxy: unknown = new Proxy({}, {
    get(_target, key) {
      if (key === "then") return (resolve: (value: unknown) => void) => resolve(state.queues[table]?.shift() ?? { data: null, error: null });
      if (key === "update" || key === "insert") return (values: unknown) => { state.writes.push({ table, values }); return proxy; };
      return () => proxy;
    },
  });
  return proxy;
}
const service = vi.hoisted(() => ({ createDraft: vi.fn(), editDraft: vi.fn(), revertDraft: vi.fn(), discardDraft: vi.fn() }));
const errors = vi.hoisted(() => ({ ConnectionRequired: class extends Error {} }));
const { ConnectionRequired } = errors;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: builder }) }));
vi.mock("@/lib/security/encryption", () => ({ encryptText: (value: string) => `enc(${value})`, decryptText: (value: string) => value.replace(/^enc\((.*)\)$/s, "$1") }));
vi.mock("@/lib/security/pii-hmac", () => ({ piiHmac: (value: string) => `h(${value})` }));
vi.mock("@/lib/auth/google-credential-broker", () => ({ GoogleConnectionRequiredError: errors.ConnectionRequired }));
vi.mock("@/lib/tools/email/google-gmail", () => ({ GoogleGmailAccessError: class extends Error { reason = "unavailable"; } }));
vi.mock("@/lib/drafts/service", () => ({ ...service, DraftsDisabledError: class extends Error {}, DraftNotFoundError: class extends Error {} }));

import { lastDraftPreview, resolvePendingEmailDraft, runDraftPayload } from "./email-draft";

const payload = { action: "create" as const, spec: { to: ["a@b.com"], subject: "Lease", body: "Hi" } };
const pending = (extra: object = {}) => {
  state.queues.workflow_checkpoints = [{ data: [{ id: "cp1", checkpoint: { payloadCiphertext: `enc(${JSON.stringify(payload)})` } }], error: null }, { data: null, error: null }];
  state.queues.approvals = [{ data: { id: "ap1", expires_at: new Date(Date.now() + 600_000).toISOString(), status: "pending", ...extra }, error: null }];
};

beforeEach(() => {
  state.queues = {}; state.writes = [];
  Object.values(service).forEach((mock) => mock.mockReset());
  service.createDraft.mockResolvedValue({ id: "d1", versionIndex: 0 });
  service.editDraft.mockResolvedValue({ status: "ok", versionIndex: 1 });
  service.revertDraft.mockResolvedValue({ status: "ok", versionIndex: 2 });
  service.discardDraft.mockResolvedValue({ status: "discarded" });
});

describe("running an approved draft action (free, fake service)", () => {
  it("saves a new draft and says plainly that it was not sent", async () => {
    const result = await runDraftPayload("u1", "c1", payload);
    expect(service.createDraft).toHaveBeenCalledWith("u1", "c1", payload.spec);
    expect(result.answer).toMatch(/Saved to your Gmail Drafts as “Lease”/);
    expect(result.answer).toMatch(/\*\*not\*\* been sent/);
    expect(result.answer).toMatch(/I never send email/);
  });

  it("deletes the earlier draft it replaces, but only after the new one is saved", async () => {
    const order: string[] = [];
    service.createDraft.mockImplementation(async () => { order.push("create"); return { id: "d2", versionIndex: 0 }; });
    service.discardDraft.mockImplementation(async () => { order.push("discard"); return { status: "discarded" }; });
    const result = await runDraftPayload("u1", "c1", { ...payload, replaces: "old1" });
    expect(order).toEqual(["create", "discard"]);
    expect(service.discardDraft).toHaveBeenCalledWith("u1", "old1", { force: false });
    expect(result.answer).toMatch(/deleted the earlier draft reply/);
  });

  it("leaves the earlier draft alone when the person edited it in Gmail, and says so", async () => {
    service.discardDraft.mockResolvedValue({ status: "conflict", liveBody: "their edit" });
    const result = await runDraftPayload("u1", "c1", { ...payload, replaces: "old1" });
    expect(result.answer).toMatch(/left your earlier draft alone because you have edited it in Gmail/);
  });

  it("keeps the new draft even if deleting the earlier one fails", async () => {
    service.discardDraft.mockRejectedValue(new Error("gmail down"));
    const result = await runDraftPayload("u1", "c1", { ...payload, replaces: "old1" });
    expect(result.answer).toMatch(/Saved to your Gmail Drafts/);
  });

  it("keeps a person's own edit in Gmail as a version before it changes a draft", async () => {
    await runDraftPayload("u1", "c1", { action: "edit", draftId: "d1", subject: "S", body: "B" });
    expect(service.editDraft).toHaveBeenCalledWith("u1", "d1", { body: "B", subject: "S" }, { keepLive: true });
    await runDraftPayload("u1", "c1", { action: "revert", draftId: "d1", versionIndex: 0 });
    expect(service.revertDraft).toHaveBeenCalledWith("u1", "d1", 0, { keepLive: true });
  });

  it("says so, and leaves it alone, when the draft is gone from Gmail", async () => {
    service.editDraft.mockResolvedValue({ status: "gone" });
    expect((await runDraftPayload("u1", "c1", { action: "edit", draftId: "d1", subject: "S", body: "B" })).answer).toMatch(/no longer in your Gmail Drafts/);
  });

  it("deletes a draft only when asked, and says nothing was sent", async () => {
    const result = await runDraftPayload("u1", "c1", { action: "discard", draftId: "d1" });
    expect(service.discardDraft).toHaveBeenCalledWith("u1", "d1", { force: true });
    expect(result.answer).toMatch(/Deleted the draft.*Nothing was sent/);
  });
});

describe("Confirm and Cancel on a draft (free, fake database)", () => {
  it("returns nothing when no draft is waiting", async () => {
    expect(await resolvePendingEmailDraft("u1", "c1", "confirm")).toBeNull();
  });

  it("saves nothing on Cancel", async () => {
    pending();
    expect((await resolvePendingEmailDraft("u1", "c1", "cancel"))?.answer).toMatch(/Cancelled. Nothing was saved or sent/);
    expect(service.createDraft).not.toHaveBeenCalled();
  });

  it("saves the draft exactly as previewed on Confirm, and marks the approval used", async () => {
    pending();
    state.queues.approvals.push({ data: { id: "ap1" }, error: null }); // the claim
    const result = await resolvePendingEmailDraft("u1", "c1", "confirm");
    expect(service.createDraft).toHaveBeenCalledWith("u1", "c1", payload.spec);
    expect(result?.answer).toMatch(/Saved to your Gmail Drafts/);
    expect(state.writes.some((write) => write.table === "approvals" && (write.values as { status?: string }).status === "consumed")).toBe(true);
  });

  it("does not save an expired preview", async () => {
    pending({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await resolvePendingEmailDraft("u1", "c1", "confirm"))?.answer).toMatch(/expired/);
    expect(service.createDraft).not.toHaveBeenCalled();
  });

  it("asks to reconnect Google when drafting permission is missing, and keeps the approval waiting", async () => {
    pending();
    state.queues.approvals.push({ data: { id: "ap1" }, error: null });
    service.createDraft.mockRejectedValue(new ConnectionRequired());
    const result = await resolvePendingEmailDraft("u1", "c1", "confirm");
    expect(result?.answer).toMatch(/Reconnect Google and approve drafts/);
    expect(result?.status).toBe("waiting_for_user");
    expect(state.writes.some((write) => write.table === "approvals" && (write.values as { status?: string }).status === "pending")).toBe(true);
  });
});

describe("the newest draft preview, whatever became of it (free, fake database)", () => {

  it("returns a waiting preview as pending", async () => {
    pending();
    state.queues.workflow_checkpoints = [{ data: [{ id: "cp1", state: "pending_approval", checkpoint: { payloadCiphertext: `enc(${JSON.stringify(payload)})` } }], error: null }];
    expect(await lastDraftPreview("u1", "c1")).toEqual({ state: "pending", payload });
  });

  it.each([["cancelled", "cancelled"], ["expired", "expired"], ["completed", "completed"]])("returns a %s preview too, so a change does not depend on what the person pressed", async (stored, expected) => {
    state.queues.workflow_checkpoints = [{ data: [{ id: "cp1", state: stored, checkpoint: { payloadCiphertext: `enc(${JSON.stringify(payload)})` } }], error: null }];
    expect(await lastDraftPreview("u1", "c1")).toEqual({ state: expected, payload });
  });

  it("calls a preview whose approval has run out expired, and returns nothing when there is none", async () => {
    state.queues.workflow_checkpoints = [{ data: [{ id: "cp1", state: "pending_approval", checkpoint: { payloadCiphertext: `enc(${JSON.stringify(payload)})` } }], error: null }];
    state.queues.approvals = [{ data: null, error: null }];
    expect((await lastDraftPreview("u1", "c1"))?.state).toBe("expired");
    state.queues = {};
    expect(await lastDraftPreview("u1", "c1")).toBeNull();
  });
});
