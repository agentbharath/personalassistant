import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const world = vi.hoisted(() => ({
  rows: [] as Row[],
  failInsert: false,
  gmail: new Map<string, { raw: string; threadId?: string; text: string }>(),
  requests: [] as string[],
  capabilities: [] as string[],
  nextId: 1,
}));

vi.mock("@/lib/auth/google-credential-broker", () => ({
  GoogleConnectionRequiredError: class extends Error {},
  withGoogleCredential: async (_user: string, capability: string, operation: (token: string) => Promise<unknown>) => { world.capabilities.push(capability); return operation("token"); },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (_table: string) => {
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row = {};
      const filters: Array<(row: Row) => boolean> = [];
      const matching = () => world.rows.filter((row) => filters.every((filter) => filter(row)));
      const run = () => {
        if (op === "update") { matching().forEach((row) => Object.assign(row, payload)); return { error: null }; }
        if (op === "delete") { world.rows = world.rows.filter((row) => !matching().includes(row)); return { error: null }; }
        return { data: matching(), error: null };
      };
      const api: Record<string, unknown> = {
        insert: (row: Row) => { op = "insert"; payload = row; return api; },
        select: () => api,
        update: (patch: Row) => { op = "update"; payload = patch; return api; },
        delete: () => { op = "delete"; return api; },
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return api; },
        is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return api; },
        single: async () => {
          if (op === "insert") { if (world.failInsert) return { data: null, error: new Error("insert failed") }; const row = { id: `row-${world.nextId++}`, discarded_at: null, ...payload }; world.rows.push(row); return { data: { id: row.id }, error: null }; }
          return { data: matching()[0] ?? null, error: null };
        },
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve(run()),
      };
      return api;
    },
  }),
}));

const bodyOf = (raw: string) => {
  const message = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return Buffer.from(message.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
};

/** A tiny fake Gmail that only knows drafts, and records every request so the test can check nothing else was ever called. */
function installFakeGmail() {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    world.requests.push(`${method} ${url.pathname}`);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const id = url.pathname.split("/drafts/")[1];
    if (method === "POST" && url.pathname.endsWith("/drafts")) {
      const { message } = JSON.parse(init!.body!) as { message: { raw: string; threadId?: string } };
      const draftId = `d${world.gmail.size + 1}`;
      world.gmail.set(draftId, { raw: message.raw, threadId: message.threadId, text: bodyOf(message.raw) });
      return json({ id: draftId, message: { id: `m-${draftId}`, threadId: message.threadId ?? `t-${draftId}` } });
    }
    const draft = world.gmail.get(id);
    if (!draft) return json({ error: "not found" }, 404);
    if (method === "GET") return json({ id, message: { threadId: draft.threadId, payload: { mimeType: "text/plain", body: { data: Buffer.from(draft.text, "utf8").toString("base64url") } } } });
    if (method === "PUT") {
      const { message } = JSON.parse(init!.body!) as { message: { raw: string; threadId?: string } };
      world.gmail.set(id, { raw: message.raw, threadId: message.threadId, text: bodyOf(message.raw) });
      return json({ id });
    }
    if (method === "DELETE") { world.gmail.delete(id); return new Response(null, { status: 204 }); }
    return json({ error: "unexpected" }, 400);
  }));
}

process.env.APP_ENCRYPTION_KEY = "test-key-for-draft-tests";
import { DraftNotFoundError, DraftsDisabledError, createDraft, discardDraft, editDraft, listVersions, revertDraft } from "./service";

const spec = { to: ["sarah@example.com"], subject: "Friday", body: "I'll be there." };

beforeEach(() => {
  world.rows = []; world.failInsert = false; world.gmail = new Map(); world.requests = []; world.capabilities = []; world.nextId = 1;
  process.env.DRAFTS_ENABLED = "true";
  installFakeGmail();
});

describe("drafting is off by default", () => {
  it("does nothing, and makes no Gmail call, while the switch is off", async () => {
    process.env.DRAFTS_ENABLED = "false";
    await expect(createDraft("u1", "c1", spec)).rejects.toBeInstanceOf(DraftsDisabledError);
    expect(world.requests).toEqual([]);
  });
});

describe("creating a draft", () => {
  it("saves it in Gmail, records it, encrypts the saved wording, and never sends", async () => {
    const created = await createDraft("u1", "c1", spec);
    expect(world.requests).toEqual(["POST /gmail/v1/users/me/drafts"]);
    expect(world.capabilities).toEqual(["email_drafts"]);
    expect(world.gmail.get("d1")?.text).toBe("I'll be there.");
    expect(world.rows).toHaveLength(1);
    expect(String(world.rows[0].versions_ciphertext)).not.toContain("be there");
    expect(await listVersions("u1", created.id)).toMatchObject([{ index: 0, note: "created", subject: "Friday" }]);
  });

  it("rejects a malformed draft before any network call", async () => {
    await expect(createDraft("u1", "c1", { ...spec, to: ["nobody"] })).rejects.toThrow(/DRAFT_INVALID/);
    expect(world.requests).toEqual([]);
  });

  it("removes the Gmail draft again if Daylark cannot record it", async () => {
    world.failInsert = true;
    await expect(createDraft("u1", "c1", spec)).rejects.toThrow();
    expect(world.gmail.size).toBe(0);
    expect(world.requests).toEqual(["POST /gmail/v1/users/me/drafts", "DELETE /gmail/v1/users/me/drafts/d1"]);
  });
});

describe("editing and going back", () => {
  it("edits the same draft and keeps every version", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    expect(await editDraft("u1", id, { body: "I'll be there at 6." })).toEqual({ status: "ok", versionIndex: 1 });
    expect(world.gmail.get("d1")?.text).toBe("I'll be there at 6.");
    expect((await listVersions("u1", id)).map((version) => version.note)).toEqual(["created", "edited"]);
  });

  it("goes back to the first version, and saves the restore as a new version", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    await editDraft("u1", id, { body: "Completely different." });
    expect(await revertDraft("u1", id, 0)).toEqual({ status: "ok", versionIndex: 2 });
    expect(world.gmail.get("d1")?.text).toBe("I'll be there.");
    expect((await listVersions("u1", id)).map((version) => version.note)).toEqual(["created", "edited", "restored version 1"]);
  });

  it("never overwrites an edit the person made in Gmail: it stops and reports", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    world.gmail.get("d1")!.text = "I rewrote this myself in Gmail.";
    const result = await editDraft("u1", id, { body: "Daylark's new wording" });
    expect(result).toEqual({ status: "conflict", liveBody: "I rewrote this myself in Gmail." });
    expect(world.gmail.get("d1")?.text).toBe("I rewrote this myself in Gmail.");
    expect(world.requests.filter((request) => request.startsWith("PUT"))).toEqual([]);
  });

  it("can keep the person's edit as a saved version first, then restore", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    world.gmail.get("d1")!.text = "My own words.";
    expect(await revertDraft("u1", id, 0, { keepLive: true })).toEqual({ status: "ok", versionIndex: 2 });
    expect(world.gmail.get("d1")?.text).toBe("I'll be there.");
    const versions = await listVersions("u1", id);
    expect(versions.map((version) => version.note)).toEqual(["created", "your edit in Gmail", "restored version 1"]);
    expect(versions[1].preview).toBe("My own words.");
  });

  it("says a draft is gone when it was sent or deleted in Gmail", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    world.gmail.delete("d1");
    expect(await editDraft("u1", id, { body: "x" })).toEqual({ status: "gone" });
    await expect(listVersions("u1", id)).rejects.toBeInstanceOf(DraftNotFoundError);
  });
});

describe("discarding a draft", () => {
  it("deletes it from Gmail and drops the saved versions", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    expect(await discardDraft("u1", id)).toEqual({ status: "discarded" });
    expect(world.gmail.size).toBe(0);
    expect(world.rows[0].discarded_at).not.toBeNull();
    expect(world.rows[0].versions_ciphertext).toBeNull();
  });

  it("asks before discarding a draft the person edited, and only discards it when forced", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    world.gmail.get("d1")!.text = "Edited by me.";
    expect(await discardDraft("u1", id)).toEqual({ status: "conflict", liveBody: "Edited by me." });
    expect(world.gmail.size).toBe(1);
    expect(await discardDraft("u1", id, { force: true })).toEqual({ status: "discarded" });
    expect(world.gmail.size).toBe(0);
  });

  it("reports a draft that is already gone (for example sent from Gmail) without recalling anything", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    world.gmail.delete("d1");
    expect(await discardDraft("u1", id)).toEqual({ status: "gone" });
  });
});

describe("only drafts Daylark created, for the right person", () => {
  it("does not find another person's draft, or one that does not exist, or a discarded one", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    await expect(discardDraft("u2", id)).rejects.toBeInstanceOf(DraftNotFoundError);
    await expect(editDraft("u1", "row-999", { body: "x" })).rejects.toBeInstanceOf(DraftNotFoundError);
    await discardDraft("u1", id);
    await expect(editDraft("u1", id, { body: "x" })).rejects.toBeInstanceOf(DraftNotFoundError);
  });

  it("only ever calls the four draft endpoints, in a full create, edit, restore and discard run", async () => {
    const { id } = await createDraft("u1", "c1", spec);
    await editDraft("u1", id, { body: "v2" });
    await revertDraft("u1", id, 0);
    await discardDraft("u1", id);
    const allowed = /^(POST \/gmail\/v1\/users\/me\/drafts|(GET|PUT|DELETE) \/gmail\/v1\/users\/me\/drafts\/d\d+)$/;
    expect(world.requests.every((request) => allowed.test(request))).toBe(true);
    expect(world.requests.some((request) => /send|trash|modify|messages/.test(request))).toBe(false);
    expect(new Set(world.capabilities)).toEqual(new Set(["email_drafts"]));
  });
});
