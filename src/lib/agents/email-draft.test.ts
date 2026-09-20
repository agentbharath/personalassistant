import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailContent, EmailSearchResult } from "@/lib/tools/email/google-gmail";

vi.mock("@/lib/drafts/service", () => ({ draftsEnabled: () => true, latestDraft: vi.fn() }));
vi.mock("@/lib/drafts/writer-runtime", () => ({ writeDraftForUser: vi.fn() }));
vi.mock("@/lib/tools/email/google-gmail", () => ({ GoogleGmailAccessError: class extends Error { reason = "unavailable"; }, readGmailMessage: vi.fn(), searchGmail: vi.fn() }));
vi.mock("@/lib/workflows/email-draft", () => ({ createDraftApproval: vi.fn(), lastDraftPreview: vi.fn(), resolvePendingEmailDraft: vi.fn() }));
vi.mock("@/lib/auth/google-credential-broker", () => ({ GoogleConnectionRequiredError: class extends Error {} }));

import { DRAFTS_NOT_AVAILABLE, pickVersion, prepareEmailDraft, type DraftContext, type DraftDeps, type DraftIntent } from "./email-draft";

const intent = (over: Partial<DraftIntent>): DraftIntent => ({ action: "create", kind: "new", to: null, replyTo: null, instruction: null, version: null, ...over } as DraftIntent);
const ctx: DraftContext = { userId: "u1", conversationId: "c1", ownerName: "Bharath", ownerEmail: "me@x.com", emailState: null };
const found = (from: string, id = "m1", receivedAt = 100): EmailSearchResult => ({ id, threadId: "t1", subject: "Lease", from, date: "Mon, 15 Sep 2026 10:00:00 -0700", receivedAt, snippet: "", to: "" });
const original = (over: object = {}): EmailContent => ({ ...found("Sarah Kim <sarah@kim.com>"), text: "Can you make Saturday?", attachments: [], reply: { messageId: "<abc@mail>", references: ["<root@mail>"], replyTo: "", to: "me@x.com" }, ...over });

let deps: DraftDeps;
beforeEach(() => {
  deps = {
    enabled: () => true,
    search: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue(original()),
    write: vi.fn().mockResolvedValue({ subject: "Hello", body: "Hi Sarah,\n\nYes, I can make it.\n\nThanks" }),
    latest: vi.fn().mockResolvedValue(null),
    approve: vi.fn().mockResolvedValue(undefined),
    lastPreview: vi.fn().mockResolvedValue(null),
    cancelPending: vi.fn().mockResolvedValue(null),
  } as unknown as DraftDeps;
});

describe("preparing a draft (free, fake Gmail and writer)", () => {
  it("says so, and does nothing, while drafting is switched off", async () => {
    const reply = await prepareEmailDraft(intent({ to: "sarah", instruction: "hi" }), ctx, { ...deps, enabled: () => false });
    expect(reply.answer).toBe(DRAFTS_NOT_AVAILABLE);
    expect(deps.approve).not.toHaveBeenCalled();
  });

  it("needs a saved conversation for an approval to wait in", async () => {
    expect((await prepareEmailDraft(intent({ to: "a@b.com", instruction: "hi" }), { ...ctx, conversationId: undefined }, deps)).status).toBe("waiting_for_user");
  });

  it("asks who it is for, and what it should say, before writing anything", async () => {
    expect((await prepareEmailDraft(intent({ instruction: "hi" }), ctx, deps)).answer).toMatch(/Who is it for/);
    expect((await prepareEmailDraft(intent({ to: "a@b.com" }), ctx, deps)).answer).toMatch(/What should the email say/);
    expect(deps.write).not.toHaveBeenCalled();
  });

  it("writes a new email to an address it was given, shows a preview that says nothing is sent, and waits for approval", async () => {
    const reply = await prepareEmailDraft(intent({ to: "sam@lee.com", instruction: "ask about the lease" }), ctx, deps);
    expect(reply.answer).toContain("Draft email — not sent");
    expect(reply.answer).toContain("**To:** sam@lee.com");
    expect(reply.answer).toContain("> Hi Sarah,");
    expect(reply.answer).toContain("**Nothing is sent**");
    expect(deps.approve).toHaveBeenCalledWith("u1", "c1", { action: "create", spec: { to: ["sam@lee.com"], subject: "Hello", body: "Hi Sarah,\n\nYes, I can make it.\n\nThanks" } });
  });

  it("finds a recipient by name in the owner's mail, and asks for the address when there is none", async () => {
    (deps.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ ...found("me@x.com"), to: "Green Street Landlord <landlord@greenstreet.com>" }]);
    const reply = await prepareEmailDraft(intent({ to: "landlord", instruction: "report the leak" }), ctx, deps);
    expect(reply.answer).toContain("landlord@greenstreet.com");
    const none = await prepareEmailDraft(intent({ to: "zed", instruction: "hi" }), ctx, deps);
    expect(none.answer).toMatch(/What's their address/);
  });

  it("asks which person when two are about equally likely, with self-contained choices", async () => {
    (deps.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([found("Sam Lee <sam@lee.com>"), found("Sam Park <sam@park.com>")]);
    const reply = await prepareEmailDraft(intent({ to: "sam", instruction: "hi" }), ctx, deps);
    expect(reply.choices).toEqual(["Write to sam@lee.com", "Write to sam@park.com"]);
    expect(deps.approve).not.toHaveBeenCalled();
  });

  it("writes a reply under the message it answers: same thread, In-Reply-To, and a Re: subject that is not doubled", async () => {
    (deps.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([found("Sarah Kim <sarah@kim.com>", "m9", 300)]);
    const reply = await prepareEmailDraft(intent({ kind: "reply", to: "sarah", instruction: "say yes" }), ctx, deps);
    expect(deps.read).toHaveBeenCalledWith("u1", "m9");
    expect(reply.answer).toContain("Draft reply — not sent");
    expect(reply.answer).toContain("**Subject:** Re: Lease");
    expect(reply.answer).toContain("Replying to “Lease” from Sarah Kim");
    expect(deps.approve).toHaveBeenCalledWith("u1", "c1", { action: "create", spec: expect.objectContaining({ to: ["sarah@kim.com"], subject: "Re: Lease", inReplyTo: { messageId: "<abc@mail>", references: ["<root@mail>"], threadId: "t1" } }) });
    (deps.read as ReturnType<typeof vi.fn>).mockResolvedValueOnce(original({ subject: "RE: Lease" }));
    (deps.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([found("Sarah Kim <sarah@kim.com>", "m9", 300)]);
    expect((await prepareEmailDraft(intent({ kind: "reply", to: "sarah", instruction: "x" }), ctx, deps)).answer).toContain("**Subject:** RE: Lease");
  });

  it("replies to the email the person pointed at in the last search, by its number", async () => {
    const withState = { ...ctx, emailState: { request: {} as never, results: [{ id: "a", subject: "A", from: "x", date: "" }, { id: "b", subject: "B", from: "y", date: "" }], updatedAt: 1 } };
    await prepareEmailDraft(intent({ kind: "reply", replyTo: "2", instruction: "thanks" }), withState, deps);
    expect(deps.read).toHaveBeenCalledWith("u1", "b");
    const ask = await prepareEmailDraft(intent({ kind: "reply", instruction: "thanks" }), withState, deps);
    expect(ask.choices).toEqual(["1", "2"]);
  });

  it("uses the reply-to address when the message names one", async () => {
    (deps.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([found("Sarah Kim <sarah@kim.com>", "m9", 300)]);
    (deps.read as ReturnType<typeof vi.fn>).mockResolvedValueOnce(original({ reply: { messageId: "<a@m>", references: [], replyTo: "Support <help@kim.com>", to: "" } }));
    await prepareEmailDraft(intent({ kind: "reply", to: "sarah", instruction: "x" }), ctx, deps);
    expect(deps.approve).toHaveBeenCalledWith("u1", "c1", { action: "create", spec: expect.objectContaining({ to: ["help@kim.com"] }) });
  });

  it("says it could not write the draft, and saves nothing, when the writer fails", async () => {
    (deps.write as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const reply = await prepareEmailDraft(intent({ to: "a@b.com", instruction: "hi" }), ctx, deps);
    expect(reply.answer).toMatch(/couldn't write that draft/);
    expect(deps.approve).not.toHaveBeenCalled();
  });
});

describe("changing a draft already saved (free)", () => {
  const version = (n: number) => ({ at: "t", subject: `S${n}`, body: `Body ${n}`, to: ["a@b.com"], cc: [], note: "" });

  it("tells the person there is no draft to change", async () => {
    expect((await prepareEmailDraft(intent({ action: "edit", instruction: "shorter" }), ctx, deps)).answer).toMatch(/don't have a draft/);
  });

  it("edits the newest draft in this chat: the writer sees its current wording, and the preview says it updates the same draft", async () => {
    (deps.latest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1", versions: [version(1)] });
    const reply = await prepareEmailDraft(intent({ action: "edit", instruction: "make it shorter" }), ctx, deps);
    expect(deps.write).toHaveBeenCalledWith("u1", { kind: "edit", instruction: "make it shorter", ownerName: "Bharath", current: { subject: "S1", body: "Body 1" } });
    expect(deps.approve).toHaveBeenCalledWith("u1", "c1", { action: "edit", draftId: "d1", subject: "Hello", body: "Hi Sarah,\n\nYes, I can make it.\n\nThanks" });
    expect(reply.answer).toContain("I'll update the same Gmail draft.");
  });

  it("goes back to the first or the previous version, and asks which when it cannot tell", async () => {
    (deps.latest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1", versions: [version(1), version(2), version(3)] });
    await prepareEmailDraft(intent({ action: "revert", version: "first" }), ctx, deps);
    expect(deps.approve).toHaveBeenLastCalledWith("u1", "c1", { action: "revert", draftId: "d1", versionIndex: 0 });
    await prepareEmailDraft(intent({ action: "revert", version: "previous" }), ctx, deps);
    expect(deps.approve).toHaveBeenLastCalledWith("u1", "c1", { action: "revert", draftId: "d1", versionIndex: 1 });
    const unclear = await prepareEmailDraft(intent({ action: "revert", version: "the good one" }), ctx, deps);
    expect(unclear.choices).toEqual(["The first version", "The previous version"]);
  });

  it("says there is nothing to go back to when the draft has one version", async () => {
    (deps.latest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1", versions: [version(1)] });
    expect((await prepareEmailDraft(intent({ action: "revert", version: "first" }), ctx, deps)).answer).toMatch(/only one version/);
  });

  it("asks before deleting a draft", async () => {
    (deps.latest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1", versions: [version(1)] });
    const reply = await prepareEmailDraft(intent({ action: "discard" }), ctx, deps);
    expect(reply.answer).toContain("Delete this draft?");
    expect(deps.approve).toHaveBeenCalledWith("u1", "c1", { action: "discard", draftId: "d1" });
  });

  it("maps version words to positions", () => {
    expect(pickVersion("first", 3)).toBe(0);
    expect(pickVersion("original", 3)).toBe(0);
    expect(pickVersion("previous", 3)).toBe(1);
    expect(pickVersion("2", 3)).toBe(1);
    expect(pickVersion("9", 3)).toBeNull();
    expect(pickVersion("first", 1)).toBeNull();
  });
});

describe("changing a draft that was shown but not saved (free)", () => {
  const unsaved = { action: "create" as const, spec: { to: ["sam@lee.com"], subject: "Lease", body: "Hi Sam, quick question about the lease.", inReplyTo: { messageId: "<a@m>", references: [], threadId: "t1" } } };
  const last = (state: string, payload: unknown = unsaved) => (deps.lastPreview as ReturnType<typeof vi.fn>).mockResolvedValue({ state, payload });

  it.each(["pending", "cancelled", "expired"])("rewrites the last draft shown even if it is %s, keeping who it is for and the thread", async (state) => {
    last(state);
    const reply = await prepareEmailDraft(intent({ action: "edit", instruction: "make it professional" }), ctx, deps);
    expect(deps.write).toHaveBeenCalledWith("u1", { kind: "edit", instruction: "make it professional", ownerName: "Bharath", current: { subject: "Lease", body: "Hi Sam, quick question about the lease." } });
    expect(deps.approve).toHaveBeenCalledWith("u1", "c1", { action: "create", spec: { ...unsaved.spec, subject: "Hello", body: "Hi Sarah,\n\nYes, I can make it.\n\nThanks" } });
    expect(reply.answer).toContain("Draft reply — not sent");
    expect(reply.answer).toContain("**To:** sam@lee.com");
    expect(reply.answer).not.toMatch(/don't have a draft/);
    expect(deps.latest).not.toHaveBeenCalled();
  });

  it("keeps changing the same draft, one change after another", async () => {
    last("pending", { action: "edit", draftId: "d1", subject: "S", body: "B" });
    await prepareEmailDraft(intent({ action: "edit", instruction: "shorter" }), ctx, deps);
    expect(deps.approve).toHaveBeenCalledWith("u1", "c1", { action: "edit", draftId: "d1", subject: "Hello", body: "Hi Sarah,\n\nYes, I can make it.\n\nThanks" });
  });

  it("scraps a waiting draft when asked, and says a cancelled one was never saved", async () => {
    last("pending");
    expect((await prepareEmailDraft(intent({ action: "discard" }), ctx, deps)).answer).toMatch(/Nothing was saved or sent/);
    expect(deps.cancelPending).toHaveBeenCalledWith("u1", "c1");
    (deps.cancelPending as ReturnType<typeof vi.fn>).mockClear();
    last("cancelled");
    expect((await prepareEmailDraft(intent({ action: "discard" }), ctx, deps)).answer).toMatch(/never saved/);
    expect(deps.cancelPending).not.toHaveBeenCalled();
    expect(deps.approve).not.toHaveBeenCalled();
  });

  it("says there is nothing earlier to go back to when nothing is saved yet", async () => {
    last("pending");
    expect((await prepareEmailDraft(intent({ action: "revert", version: "first" }), ctx, deps)).answer).toMatch(/Nothing has been saved yet/);
  });

  it("uses the saved Gmail draft once the last one shown was saved", async () => {
    last("completed");
    (deps.latest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1", versions: [{ at: "t", subject: "S", body: "Saved body", to: ["a@b.com"], cc: [], note: "" }] });
    await prepareEmailDraft(intent({ action: "edit", instruction: "shorter" }), ctx, deps);
    expect(deps.write).toHaveBeenCalledWith("u1", expect.objectContaining({ current: { subject: "S", body: "Saved body" } }));
    expect(deps.approve).toHaveBeenCalledWith("u1", "c1", expect.objectContaining({ action: "edit", draftId: "d1" }));
  });

  it("does not change a pending delete or restore; it looks at the saved draft instead", async () => {
    last("pending", { action: "discard", draftId: "d1" });
    expect((await prepareEmailDraft(intent({ action: "edit", instruction: "shorter" }), ctx, deps)).answer).toMatch(/don't have a draft/);
  });
});
