import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({get:vi.fn(),append:vi.fn(),run:vi.fn(),writeMemories:vi.fn(),after:vi.fn((cb:() => unknown)=>cb())}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:"user"}}})}})}));
vi.mock("@/lib/orchestrator/run",()=>({runOrchestrator:mocks.run}));
vi.mock("@/lib/conversations/store",()=>({getConversation:mocks.get,appendMessage:mocks.append,createConversation:vi.fn().mockResolvedValue("conv-id"),compactConversationContext:vi.fn(),latestSequence:vi.fn()}));
vi.mock("next/server",()=>({after:mocks.after}));
vi.mock("@/lib/memory/extractor-runtime",()=>({writeMemoriesFromMessage:mocks.writeMemories}));
vi.mock("@/lib/observability/query-telemetry",()=>({recordQueryTelemetry:vi.fn()}));
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

it("never re-reads the message for background memory extraction after an explicit \"remember that...\" already handled it deliberately (R.memory, found live)", async () => {
  mocks.get.mockResolvedValue({ contextMessages: [] });
  mocks.append.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue({ requestId: "r1", answer: "Got it.", agents: [], confidence: 1, status: "completed", operation: "memory_remember" });
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "remember that I don't eat meat except chicken, fish and shrimp", conversationId: "00000000-0000-4000-8000-000000000001" }) }));
  expect(response.status).toBe(200);
  expect(mocks.writeMemories).not.toHaveBeenCalled();
});

it("still runs background memory extraction for an ordinary message (no regression)", async () => {
  mocks.get.mockResolvedValue({ contextMessages: [] });
  mocks.append.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue({ requestId: "r1", answer: "Sure.", agents: ["general"], confidence: 1, status: "completed", operation: "web_search" });
  await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "best sushi near me", conversationId: "00000000-0000-4000-8000-000000000001" }) }));
  expect(mocks.writeMemories).toHaveBeenCalledWith("user", "best sushi near me");
});
