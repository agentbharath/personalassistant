import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks=vi.hoisted(()=>({get:vi.fn(),report:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:"user"}}})}})}));
vi.mock("@/lib/conversations/store",()=>({getConversation:mocks.get,listConversations:async()=>[]}));
vi.mock("@/lib/replies/dismissals",()=>({isPerchEnabled:async()=>false}));
vi.mock("@/lib/observability/report",()=>({reportFailure:mocks.report,logEvent:vi.fn()}));
vi.mock("../auth/actions",()=>({signOut:vi.fn()}));
vi.mock("@/components/chat/Chat",()=>({Chat:()=> <div>CHAT COMPOSER</div>}));
vi.mock("@/components/layout/AppShell",()=>({AppShell:({children}:{children:React.ReactNode})=> <div>{children}</div>}));
import HomePage from "./page";
beforeEach(()=>vi.clearAllMocks());
it("shows a retry state instead of a new chat on a load error",async()=>{
  mocks.get.mockRejectedValue(new Error("missing column"));
  const html=renderToStaticMarkup(await HomePage({searchParams:Promise.resolve({conversation:"saved-chat"})}));
  expect(html).toContain("This chat couldn’t load");
  expect(html).toContain("/?conversation=saved-chat");
  expect(html).not.toContain("CHAT COMPOSER");
  expect(mocks.report).toHaveBeenCalled();
});
it("does not silently replace a missing chat with a new conversation",async()=>{
  mocks.get.mockResolvedValue(null);
  const html=renderToStaticMarkup(await HomePage({searchParams:Promise.resolve({conversation:"missing"})}));
  expect(html).toContain("This chat isn’t available");
  expect(html).not.toContain("CHAT COMPOSER");
});
it("still opens the composer for an intentionally new conversation",async()=>{
  expect(renderToStaticMarkup(await HomePage({searchParams:Promise.resolve({})}))).toContain("CHAT COMPOSER");
  expect(mocks.get).not.toHaveBeenCalled();
});
