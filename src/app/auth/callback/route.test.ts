import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({after:vi.fn(),credentials:vi.fn(),queue:vi.fn(),advance:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>undefined})}));
vi.mock("next/server",async original=>({...await original<typeof import("next/server")>(),after:mocks.after}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{exchangeCodeForSession:async()=>({data:{session:{user:{id:"u"},provider_token:"test-token"}}})}})}));
vi.mock("@/lib/auth/google-credential-broker",()=>({storeGoogleCredentials:mocks.credentials}));
vi.mock("@/lib/finance-sync/store",()=>({enabled:()=>process.env.FINANCE_SYNC_ENABLED==="true",queueSync:mocks.queue}));
vi.mock("@/lib/finance-sync/runner",()=>({advanceFinanceSync:mocks.advance}));
vi.mock("@/lib/observability/report",()=>({reportFailure:vi.fn()}));
import { GET } from "./route";
beforeEach(()=>{vi.clearAllMocks();mocks.credentials.mockResolvedValue(undefined);vi.stubEnv("FINANCE_SYNC_ENABLED","true");});
afterEach(()=>vi.unstubAllEnvs());
it("queues initial finance sync after connecting Google without delaying the redirect",async()=>{
 const response=await GET(new Request("https://example.com/auth/callback?code=code"));
 expect(response.status).toBe(307);
 expect(mocks.queue).not.toHaveBeenCalled();
 await mocks.after.mock.calls[0][0]();
 expect(mocks.queue).toHaveBeenCalledWith("u");
 expect(mocks.advance).toHaveBeenCalledWith("u",40000);
});
it("does not start processing if credential storage failed",async()=>{
 mocks.credentials.mockRejectedValue(new Error("unavailable"));
 await GET(new Request("https://example.com/auth/callback?code=code"));
 expect(mocks.after).not.toHaveBeenCalled();
});
it("respects disabled finance sync",async()=>{
 vi.stubEnv("FINANCE_SYNC_ENABLED","false");
 await GET(new Request("https://example.com/auth/callback?code=code"));
 expect(mocks.after).not.toHaveBeenCalled();
});
