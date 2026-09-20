import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderCircuitsForTest } from "../../runtime/resilient-fetch";

vi.mock("../../auth/google-credential-broker", () => ({
  withGoogleCredential: vi.fn(async (_userId: string, capability: string, operation: (token: string) => Promise<unknown>) => {
    if (capability !== "email") throw new Error("wrong capability");
    return operation("gmail-token");
  }),
}));

import { searchGmail } from "./google-gmail";

afterEach(() => { vi.unstubAllGlobals(); resetProviderCircuitsForTest(); });

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
});
