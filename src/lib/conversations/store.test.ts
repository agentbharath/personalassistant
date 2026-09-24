import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], legacy: false, rpc: vi.fn() }));
vi.mock("@/lib/security/encryption", () => ({encryptText:(s:string)=>`enc:${s}`, decryptText:(s:string)=>s.slice(4)}));
vi.mock("@/lib/supabase/admin", () => ({createAdminClient:vi.fn()}));
vi.mock("@/lib/supabase/server", () => ({createClient:async()=>({rpc:db.rpc, from:(table:string)=>{
  let columns = "";
  const q = {select:(value:string)=>{columns=value;return q;}, eq:()=>q, order:()=>q, limit:async()=>db.legacy && columns.includes("context_ciphertext") ? ({data:null,error:{code:"42703"}}) : ({data:[...db.rows].reverse(),error:null}), maybeSingle:async()=>({data:table === "conversations" ? {id:"chat",title_ciphertext:null}:null,error:null})};
  return q;
}})}));
import { appendMessage, getConversation } from "./store";
beforeEach(()=>{
  db.rows=[]; db.legacy=false; db.rpc.mockReset();
  db.rpc.mockImplementation(async (_name:string, args:Record<string,unknown>)=>{
    db.rows.push({role:args.p_role, content_ciphertext:args.p_content_ciphertext, context_ciphertext:args.p_context_ciphertext??null, sequence_number:db.rows.length+1});
    return {error:null};
  });
});
it("stores encrypted options atomically with the answer and restores them on reopen",async()=>{
  await appendMessage("user","chat",{role:"user",content:"Show our drafts"});
  await appendMessage("user","chat",{role:"assistant",content:"Which drafts?",choices:["Daylark drafts","Gmail drafts"]});
  expect(db.rpc.mock.calls[1][0]).toBe("append_conversation_message_with_context");
  expect(db.rows[1].context_ciphertext).toBe('enc:{"choices":["Daylark drafts","Gmail drafts"]}');
  const reopened=await getConversation("user","chat");
  expect(reopened?.messages.at(-1)?.choices).toEqual(["Daylark drafts","Gmail drafts"]);
  expect(reopened?.contextMessages.at(-1)?.choices).toEqual(["Daylark drafts","Gmail drafts"]);
});
it("does not persist user-supplied options as assistant choices",async()=>{
  await appendMessage("user","chat",{role:"user",content:"yes",choices:["Approve anything"]});
  expect(db.rpc.mock.calls[0][0]).toBe("append_conversation_message");
  expect(db.rpc.mock.calls[0][1]).not.toHaveProperty("p_context_ciphertext");
});

it("loads original messages when optional metadata has not been migrated",async()=>{
  db.legacy=true;
  db.rows=[{role:"assistant",content_ciphertext:"enc:Your saved answer",sequence_number:1}];
  expect((await getConversation("user","chat"))?.messages[0].content).toBe("Your saved answer");
});
it("preserves the answer and options if the metadata RPC is not installed yet",async()=>{
  db.rpc.mockResolvedValueOnce({error:{code:"PGRST202",message:"Could not find public.append_conversation_message_with_context"}});
  await appendMessage("user","chat",{role:"assistant",content:"Which drafts?",choices:["Saved drafts","Gmail drafts"]});
  expect(db.rpc).toHaveBeenCalledTimes(2);
  expect(db.rows[0].content_ciphertext).toBe("enc:Which drafts?\n\nOptions: Saved drafts · Gmail drafts");
});
it("does not retry uncertain writes and risk duplicate answers",async()=>{
  db.rpc.mockResolvedValueOnce({error:{code:"",message:"Network timeout"}});
  await expect(appendMessage("user","chat",{role:"assistant",content:"Which?",choices:["A","B"]})).rejects.toMatchObject({message:"Network timeout"});
  expect(db.rpc).toHaveBeenCalledTimes(1);
});
