import { afterEach, expect, it, vi } from "vitest";
import { streamChat } from "./stream-chat";
const encoder = new TextEncoder();
const payload = {message:"yes",isRetry:false};
const result = JSON.stringify({type:"result",status:200,body:{answer:"తెలుగు",choices:["Yes","No"]}});
afterEach(()=>vi.unstubAllGlobals());
function respond(chunks: Uint8Array[], close=true) {
  const cancel=vi.fn();
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(chunk);if(close)c.close();},cancel}),{headers:{"content-type":"application/x-ndjson"}})));
  return cancel;
}
it("accepts split UTF-8 and a final line without a newline",async()=>{
  const bytes=encoder.encode(result);
  respond(Array.from(bytes,byte=>new Uint8Array([byte])));
  expect(await streamChat(payload,new AbortController().signal,vi.fn())).toMatchObject({status:200,body:{answer:"తెలుగు",choices:["Yes","No"]}});
});
it("returns a terminal result without waiting for the connection to close",async()=>{
  const cancel=respond([encoder.encode('{"type":"progress","agents":["email"]}\n'+result+'\n')],false);
  const progress=vi.fn();
  const answer=await streamChat(payload,new AbortController().signal,progress);
  expect(answer.body?.answer).toBe("తెలుగు");
  expect(progress).toHaveBeenCalledWith(["email"],undefined);
  expect(cancel).toHaveBeenCalledOnce();
});
it("treats a truncated response as uncertain instead of a finished answer",async()=>{
  respond([encoder.encode('{"type":"progress","agents":[]}\n')]);
  await expect(streamChat(payload,new AbortController().signal,vi.fn())).rejects.toThrow("CHAT_STREAM_INCOMPLETE");
});
it("preserves structured errors from non-streaming responses",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({message:"Sign in again",retryable:false},{status:401})));
  expect(await streamChat(payload,new AbortController().signal,vi.fn())).toEqual({status:401,body:{message:"Sign in again",retryable:false}});
});
