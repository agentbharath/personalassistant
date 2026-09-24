import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "../../runtime/resilient-fetch";

vi.mock("../../auth/google-credential-broker", () => ({
  withGoogleCredential: vi.fn(async (_userId: string, capability: string, operation: (token: string) => Promise<unknown>) => {
    if (capability !== "email") throw new Error("wrong capability");
    return operation("gmail-token");
  }),
}));

const cache = vi.hoisted(() => new Map<string, string>());
vi.mock("../../runtime/encrypted-cache", () => ({ createEncryptedCache: () => ({
  get: async (key: string) => cache.get(key) ?? null,
  set: async (key: string, value: string) => { cache.set(key, value); },
}) }));
import { resetGmailPacingForTest } from "./gmail-transport";
import { searchGmail, searchGmailForImport, newGmailImportCursor } from "./google-gmail";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); cache.clear(); resetGmailPacingForTest(); });

describe("Gmail provider contract", () => {
  it("sends Gmail search syntax and returns newest metadata first", async () => {
    const providerFetch = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/messages")) return new Response(JSON.stringify({ messages: [{ id: "old", threadId: "t1" }, { id: "new", threadId: "t2" }] }), { status: 200 });
      const id = url.pathname.split("/").at(-1)!;
      const newer = id === "new";
      return new Response(JSON.stringify({ id, threadId: newer ? "t2" : "t1", internalDate: newer ? "200" : "100", snippet: "Interview", payload: { headers: [{ name: "Subject", value: newer ? "New" : "Old" }, { name: "From", value: "Recruiter" }] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", providerFetch);
    const result = await searchGmail("user", "after:2026/09/17 interview");
    const listUrl = providerFetch.mock.calls[0][0] as URL;
    expect(listUrl.searchParams.get("q")).toBe("after:2026/09/17 interview");
    expect(result.map((message) => message.id)).toEqual(["new", "old"]);
  });

  it("follows every page, caches summaries per user, and reports whether the search was complete", async () => {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/messages")) return Response.json(url.searchParams.has("pageToken")
        ? { messages: [{ id: "b", threadId: "b" }] }
        : { messages: [{ id: "a", threadId: "a" }], nextPageToken: "page2" });
      const id = url.pathname.split("/").at(-1)!;
      return Response.json({ id, threadId: id, snippet: "Paid", payload: { headers: [] } });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await searchGmailForImport("u", "newer_than:30d", 500);
    expect(result).toMatchObject({ truncated: false, failedCount: 0 });
    expect(result.messages.map((item) => item.id)).toEqual(["a", "b"]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await searchGmailForImport("u", "newer_than:30d", 500);
    expect(fetcher).toHaveBeenCalledTimes(6); // only list pages on a repeat
    await searchGmailForImport("other-user", "newer_than:30d", 500);
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it("reports a remaining page even when it exactly hits the requested cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => Response.json(url.pathname.endsWith("/messages")
      ? { messages: [{ id: "a", threadId: "a" }], nextPageToken: "page2" }
      : { id: "a", threadId: "a" })));
    expect(await searchGmailForImport("u", "newer_than:30d", 1)).toMatchObject({ truncated: true, failedCount: 0 });
  });

  it("reports failed metadata reads instead of silently claiming full coverage", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id: "ok", threadId: "a" }, { id: "gone", threadId: "b" }] });
      if (url.pathname.endsWith("/gone")) return Response.json({}, { status: 404 });
      return Response.json({ id: "ok", threadId: "a" });
    }));
    const result = await searchGmailForImport("u", "newer_than:30d", 100);
    expect(result).toMatchObject({ failedCount: 1, truncated: false });
    expect(result.messages).toHaveLength(1);
  });

  it("does not start Gmail requests after the scan deadline", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await searchGmailForImport("u", "newer_than:30d", 100, Date.now() - 1)).toMatchObject({ messages: [], truncated: true });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("propagates rejected metadata access so the credential broker can refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => url.pathname.endsWith("/messages")
      ? Response.json({ messages: [{ id: "a", threadId: "a" }] })
      : Response.json({}, { status: 401 })));
    await expect(searchGmailForImport("u", "newer_than:30d", 100)).rejects.toMatchObject({ reason: "insufficient_scope" });
  });

  it("counts summaries not reached by the deadline separately from provider failures", async () => {
    const deadline = Date.now() + 10000;
    const fetcher = vi.fn(async () => {
      vi.spyOn(Date, "now").mockReturnValue(deadline + 1);
      return Response.json({ messages: [{ id: "a", threadId: "a" }, { id: "b", threadId: "b" }] });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(await searchGmailForImport("u", "newer_than:30d", 100, deadline)).toMatchObject({ failedCount: 0, unreadCount: 2 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.restoreAllMocks(); }
  });

  it("reads older payment notices before general mail and avoids fetching their metadata twice", async () => {
    const reads: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/messages")) return Response.json({messages:url.searchParams.get("q")?.includes("subject:payment")
        ? [{id:"discover",threadId:"d"}]
        : [{id:"recent",threadId:"r"},{id:"discover",threadId:"d"}]});
      const id=url.pathname.split("/").at(-1)!;
      reads.push(id);
      return Response.json({id,threadId:id,internalDate:id === "discover" ? "100" : "200"});
    }));
    const result=await searchGmailForImport("u","newer_than:30d -subject:UPI",100,Date.now()+10000,{prioritizePayments:true});
    expect(reads).toEqual(["discover","recent"]);
    expect(result.messages.map(message=>message.id)).toEqual(["discover","recent"]);
    expect(result).toMatchObject({failedCount:0,unreadCount:0,truncated:false});
  });

  it("continues a saved page before listing the next category and never reads a completed summary again", async () => {
    const cursor = newGmailImportCursor("after:100 before:200 -subject:UPI");
    const reads: string[] = [];
    const queries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/messages")) {
        const query=url.searchParams.get("q")!; queries.push(query);
        if (query === cursor.queries[0]) return Response.json({messages:Array.from({length:8},(_,i)=>({id:`m${i}`,threadId:`t${i}`}))});
        if (query === cursor.queries[1]) return Response.json({messages:[{id:"updates",threadId:"updates"}]});
        if (query === cursor.queries[2]) return Response.json({messages:[{id:"other",threadId:"other"}]});
        return Response.json({});
      }
      const id=url.pathname.split("/").at(-1)!; reads.push(id);
      return Response.json({id,threadId:id});
    }));
    const save=vi.fn(async()=>{});
    await searchGmailForImport("u","ignored",6,undefined,{cursor,onProgress:save});
    expect(cursor.pending.map(ref=>ref.id)).toEqual(["m6","m7"]);
    expect(queries).toHaveLength(1);
    const restored=JSON.parse(JSON.stringify(cursor)); restored.ready=[];
    await searchGmailForImport("u","ignored",100,undefined,{cursor:restored,onProgress:save});
    expect(reads).toEqual(["m0","m1","m2","m3","m4","m5","m6","m7","updates","other"]);
    expect(queries).toEqual(cursor.queries);
    expect(restored.stage).toBe(4);
    expect(restored.checked).toBe(10);
    expect(save).toHaveBeenCalled();
  });

  it("persists a Gmail cooldown and makes no requests until it expires", async () => {
    const cursor=newGmailImportCursor("after:100 before:200");
    const fetcher=vi.fn(async()=>Response.json({}, {status:429,headers:{"Retry-After":"60"}}));
    vi.stubGlobal("fetch",fetcher);
    await searchGmailForImport("u","ignored",100,Date.now()+1000,{cursor});
    expect(cursor.retryAt).toBeGreaterThan(Date.now()+50000);
    expect(cursor.stage).toBe(0);
    await searchGmailForImport("u","ignored",100,Date.now()+1000,{cursor:JSON.parse(JSON.stringify(cursor))});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

});
