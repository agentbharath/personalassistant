import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({get:vi.fn(),append:vi.fn(),run:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:"user"}}})}})}));
vi.mock("@/lib/orchestrator/run",()=>({runOrchestrator:mocks.run}));
vi.mock("@/lib/conversations/store",()=>({getConversation:mocks.get,appendMessage:mocks.append,createConversation:vi.fn(),compactConversationContext:vi.fn(),latestSequence:vi.fn()}));
import { POST } from "./route";
afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(console,"error").mockImplementation(()=>undefined);});
it.each(["load","save"])("does not run a follow-up after a chat %s failure",async(stage)=>{
  mocks.get.mockResolvedValue({contextMessages:[{role:"assistant",content:"Search for sudoku code?"}]});
  mocks.append.mockResolvedValue(undefined);
  if(stage==="load")mocks.get.mockRejectedValue(new Error("offline"));
  else mocks.append.mockRejectedValue(new Error("offline"));
  const response=await POST(new Request("http://localhost/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"yes",conversationId:"00000000-0000-4000-8000-000000000001"})}));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({retryable:true,message:expect.stringContaining("haven’t processed")});
  expect(mocks.run).not.toHaveBeenCalled();
});
