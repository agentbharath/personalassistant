import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { REPLY_JSON_SCHEMA, REPLY_JUDGE_SYSTEM, REPLY_KINDS, buildReplyMessage, judgeReply, replyCacheMaterial, replyCandidates, type MailRef } from "./reply-needed";

const mail = (id: string, threadId: string, receivedAt: number): MailRef => ({ id, threadId, from: "Sam <sam@x.com>", subject: "Hi", receivedAt, snippet: "" });
const reply = (value: unknown) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] }) as unknown as Anthropic.Message;
const input = { userId: "u1", messageId: "m1", from: "Sam <sam@x.com>", subject: "Lease", text: "Can you send it by Friday?", sentAt: "2026-09-20T10:00:00.000Z" };

describe("which mail is a candidate (free)", () => {
  it("keeps the newest incoming message of a thread the owner has not answered", () => {
    const result = replyCandidates([mail("a", "t1", 100), mail("b", "t1", 200), mail("c", "t2", 150)], []);
    expect(result.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("drops a thread when the owner sent something after the newest incoming message", () => {
    expect(replyCandidates([mail("a", "t1", 100)], [{ threadId: "t1", receivedAt: 150 }])).toEqual([]);
  });

  it("keeps a thread when the owner's last reply is older than the newest incoming message", () => {
    expect(replyCandidates([mail("a", "t1", 300)], [{ threadId: "t1", receivedAt: 150 }]).map((item) => item.id)).toEqual(["a"]);
  });

  it("does not let a reply in another thread count", () => {
    expect(replyCandidates([mail("a", "t1", 100)], [{ threadId: "t2", receivedAt: 500 }])).toHaveLength(1);
  });
});

describe("the model judges whether a reply is needed (free, fake model)", () => {
  it("has no union-typed parameters and tells the model that unsure means no", () => {
    expect(JSON.stringify(REPLY_JSON_SCHEMA)).not.toMatch(/anyOf|oneOf|"type":\[/);
    expect(REPLY_JUDGE_SYSTEM).toMatch(/When unsure, say false/);
  });

  it("returns the model's judgement and its one-line reason", async () => {
    const complete = vi.fn().mockResolvedValue(reply({ needsReply: true, kind: "person", reason: "Sam asks for the signed lease by Friday." }));
    expect(await judgeReply(input, { complete })).toEqual({ needsReply: true, kind: "person", reason: "Sam asks for the signed lease by Friday." });
    expect(complete.mock.calls[0][0].temperature).toBe(0);
  });

  it("drops the reason when no reply is needed", async () => {
    expect(await judgeReply(input, { complete: async () => reply({ needsReply: false, kind: "none", reason: "newsletter" }) })).toEqual({ needsReply: false, kind: "none", reason: "" });
  });

  it("judges a message once: the second time comes from the cache", async () => {
    const store = new Map<string, string>();
    const cache = { get: async (key: string) => store.get(key) ?? null, set: async (key: string, value: string) => { store.set(key, value); } };
    const complete = vi.fn().mockResolvedValue(reply({ needsReply: true, kind: "business", reason: "x" }));
    await judgeReply(input, { complete, cache });
    await judgeReply(input, { complete, cache });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(replyCacheMaterial(input)).not.toBe(replyCacheMaterial({ ...input, messageId: "m2" }));
    expect(replyCacheMaterial(input)).not.toBe(replyCacheMaterial({ ...input, userId: "u2" }));
  });

  it("returns null, and guesses nothing, when the model fails or answers with junk", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await judgeReply(input, { complete: async () => { throw new Error("down"); } })).toBeNull();
    expect(await judgeReply(input, { complete: async () => reply("nope") })).toBeNull();
    expect(await judgeReply(input, { complete: async () => reply({ needsReply: "maybe" }) })).toBeNull();
  });

  it("tells the model that mail from an address that takes no replies never needs one, and defines each kind", () => {
    expect(REPLY_JUDGE_SYSTEM).toMatch(/does not take replies/);
    for (const kind of REPLY_KINDS) expect(REPLY_JUDGE_SYSTEM).toContain(`- ${kind}:`);
  });

  it("keeps the model's kind, and falls back to person if it says needsReply with no kind", async () => {
    expect((await judgeReply(input, { complete: async () => reply({ needsReply: true, kind: "invitation", reason: "RSVP" }) }))?.kind).toBe("invitation");
    expect((await judgeReply(input, { complete: async () => reply({ needsReply: true, kind: "none", reason: "asks" }) }))?.kind).toBe("person");
  });

  it("sends only the start of a long message", () => {
    expect(JSON.parse(buildReplyMessage({ from: "a", subject: "b", sentAt: "c", text: "x".repeat(5000) })).text).toHaveLength(1500);
  });
});
