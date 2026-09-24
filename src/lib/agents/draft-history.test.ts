import { beforeEach, expect, it, vi } from "vitest";
const db=vi.hoisted(()=>({rows:[] as Array<Record<string,unknown>>,fail:false,ranges:[] as number[]}));
vi.mock("@/lib/security/encryption",()=>({decryptText:(text:string)=>text}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({from:(table:string)=>{
  if(table!=="email_drafts")throw Error("wrong table");
  let user:string;
  const query={select:()=>query,eq:(key:string,value:string)=>{if(key!=="user_id")throw Error("unexpected filter");user=value;return query;},order:()=>query,range:async(start:number,end:number)=>{
    db.ranges.push(start);
    return {data:db.rows.filter(row=>row.user_id===user).slice(start,end+1),error:db.fail?new Error("read failed"):null};
  }};
  return query;
}})}));
import { answerDraftHistory } from "./draft-history";
const row=(index:number,user="u")=>({id:`d${index}`,user_id:user,created_at:"2026-09-21T12:00:00Z",versions_ciphertext:JSON.stringify([{subject:`Earlier ${index}`,to:["old@example.com"]},{subject:`Draft ${index}`,to:[`person${index}@example.com`],body:"private body not requested"}])});
beforeEach(()=>{db.rows=[];db.fail=false;db.ranges=[];});
it("lists latest recipients and subjects across pages and excludes other users",async()=>{
  db.rows=[...Array.from({length:102},(_,i)=>row(i)),row(500,"other")];
  const answer=await answerDraftHistory("u");
  expect(answer).toContain("Draft 101");expect(answer).toContain("person101@example\\.com");
  expect(answer).not.toContain("person500");expect(answer).not.toContain("private body");expect(answer).not.toContain("Earlier 0");
  expect(db.ranges).toEqual([0,100]);
  expect(answer).toContain("doesn’t verify whether you later sent");
});
it("does not invent details for deleted or unreadable records",async()=>{
  db.rows=[{...row(0),versions_ciphertext:null,discarded_at:"2026-09-21"},{...row(1),versions_ciphertext:"bad JSON"}];
  const answer=await answerDraftHistory("u");
  expect(answer).toContain("2 earlier draft records");expect(answer).not.toContain("person0");
});
it("distinguishes an empty history from a failed lookup",async()=>{
  expect(await answerDraftHistory("u")).toContain("haven’t saved any email drafts");
  db.fail=true;await expect(answerDraftHistory("u")).rejects.toThrow("read failed");
});
