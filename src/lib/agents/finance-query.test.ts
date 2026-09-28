import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({model:vi.fn(),list:vi.fn(),write:vi.fn()}));
vi.mock("@/lib/runtime/model-runtime",()=>({callClaude:mocks.model}));
vi.mock("@/lib/tools/finance/transactions",()=>({listTransactions:mocks.list,createTransactionCandidate:mocks.write}));
import { FINANCE_QUERY_JSON_SCHEMA, answerFinanceQuery } from "./finance-query";
import { answerFinance } from "./finance";
const plan={mode:"transactions",ranges:[{from:"2026-08-01",to:"2026-09-30"}],merchant:null,category:null,clarification:null};
const row=(id:string,date:string,direction:string="expense",currency="USD")=>({id,occurredOn:date,direction,currency,amountMinor:100,merchant:id,category:"other"});
beforeEach(()=>{vi.clearAllMocks();mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify(plan)}]});mocks.list.mockResolvedValue([row("August purchase","2026-08-01"),row("Card payment","2026-09-15","transfer"),row("Refund","2026-09-30","income"),row("INR purchase","2026-09-01","expense","INR")]);});
it("handles the reported request as a read and includes payments and refunds",async()=>{
 const answer=await answerFinance("show all the transactions happened in the month of august and september this year","u","read");
 expect(mocks.list).toHaveBeenCalledWith("u","2026-08-01","2026-09-30");
 expect(answer).toContain("4 saved records");
 for(const name of ["August purchase","Card payment","Refund","INR purchase"])expect(answer).toContain(name);
 expect(answer).not.toContain("record a spend");
 expect(mocks.write).not.toHaveBeenCalled();
 expect(mocks.model.mock.calls[0][0]).toBe("finance_query");
});
it("keeps separate months separate and counts spending without transfers",async()=>{
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({...plan,mode:"spending",ranges:[{from:"2026-08-01",to:"2026-08-31"},{from:"2026-10-01",to:"2026-10-31"}]})}]});
 mocks.list.mockResolvedValue([row("A","2026-08-01"),row("September","2026-09-15"),row("Transfer","2026-10-01","transfer"),row("C","2026-10-31")]);
 const answer=await answerFinanceQuery("August and October spending","u");
 expect(answer).toContain("2 saved records");expect(answer).toContain("$2.00");
});
it("does not silently truncate a transaction list to five entries",async()=>{
 mocks.list.mockResolvedValue(Array.from({length:60},(_,n)=>row(`Transaction ${n}`,"2026-08-15")));
 expect(await answerFinanceQuery("all transactions","u")).toContain("Transaction 59");
});
it("validates dates and never switches to recording when interpretation fails",async()=>{
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({...plan,ranges:[{from:"2026-02-30",to:"2026-09-30"}]})}]});
 expect(await answerFinanceQuery("August transactions","u")).toContain("couldn’t resolve");
 expect(mocks.list).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();
});
it("passes previous periods and the current reply to the query interpreter",async()=>{
 await answerFinanceQuery("include September too","u",[{role:"user",content:"List August 2025 transactions"}]);
 expect(mocks.model.mock.calls[0][1].messages[0].content).toContain("August 2025");
});

it("shows \"All time\" instead of the code's own 1970-01-01 sentinel for \"so far\" (found live: it read like a bug, not an all-time answer)", async () => {
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({...plan,mode:"spending",ranges:[{from:"1970-01-01",to:"2026-09-25"}]})}]});
 const answer=await answerFinanceQuery("how much have I spent so far","u");
 expect(answer).toContain("All time through 2026-09-25");
 expect(answer).not.toContain("1970-01-01");
 expect(answer).not.toContain("daylark-card");
});

it("embeds a spending card (total, vs-prior comparison, category breakdown) for a single-range spending query", async () => {
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({...plan,mode:"spending",ranges:[{from:"2026-09-01",to:"2026-09-30"}]})}]});
 mocks.list.mockImplementation(async (_u:string,from:string)=>{
  if(from==="2026-09-01") return [{...row("Trader Joe's","2026-09-05"),amountMinor:31800,category:"groceries"},{...row("DoorDash","2026-09-10"),amountMinor:19600,category:"restaurants"}];
  if(from==="2026-08-02") return [{...row("Costco","2026-08-15"),amountMinor:50000,category:"groceries"}];
  return [];
 });
 const answer=await answerFinanceQuery("how much did I spend this month","u");
 expect(mocks.list).toHaveBeenNthCalledWith(1,"u","2026-09-01","2026-09-30");
 expect(mocks.list).toHaveBeenNthCalledWith(2,"u","2026-08-02","2026-08-31");
 expect(answer).toContain("### Spending"); // the plain-text fallback stays intact for copy/older clients
 expect(answer).toContain("```daylark-card");
 const card=JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
 expect(card.kind).toBe("spending");
 expect(card.periodLabel).toContain("2026-09-01");
 expect(card.filterLabel).toBeNull();
 expect(card.summary.total).toBe(51400);
 expect(card.summary.previousTotal).toBe(50000);
 expect(card.summary.changePercent).toBe(3);
 expect(card.summary.categories.map((c:{category:string})=>c.category)).toEqual(["groceries","restaurants"]);
 expect(card.insight).toContain("Up 3% from the prior period");
 expect(card.insight).toContain("Groceries is the largest share");
});

it("does not embed a card for a multi-range spending query (no single prior period to compare)", async () => {
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({...plan,mode:"spending",ranges:[{from:"2026-08-01",to:"2026-08-31"},{from:"2026-10-01",to:"2026-10-31"}]})}]});
 mocks.list.mockResolvedValue([row("A","2026-08-01"),row("C","2026-10-31")]);
 const answer=await answerFinanceQuery("August and October spending","u");
 expect(answer).not.toContain("daylark-card");
});

it("labels the card with the requested category when the query is scoped to one", async () => {
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({...plan,mode:"spending",category:"restaurants",ranges:[{from:"2026-09-01",to:"2026-09-30"}]})}]});
 mocks.list.mockImplementation(async (_u:string,from:string)=>{
  if(from==="2026-09-01") return [{...row("DoorDash","2026-09-10"),category:"restaurants"}];
  return [];
 });
 const answer=await answerFinanceQuery("how much did I spend on food this month","u");
 const card=JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
 expect(card.filterLabel).toBe("restaurants");
 expect(card.summary.total).toBe(100);
});

it("shows the same canonical category in the transaction list as the breakdown already uses, not the raw stored casing (found live: \"Shopping\" vs \"shopping\" read like inconsistent data)", async () => {
 mocks.list.mockResolvedValue([{ ...row("iHerb order","2026-09-15"), category: "Shopping" }, { ...row("PG&E","2026-09-17"), category: "Utilities" }]);
 const answer=await answerFinanceQuery("show all transactions","u");
 expect(answer).toContain("| shopping |");
 expect(answer).toContain("| utilities |");
 expect(answer).not.toContain("| Shopping |");
 expect(answer).not.toContain("| Utilities |");
});

it("analysis mode compares the period to the equal-length period immediately before it", async () => {
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({...plan,mode:"analysis",ranges:[{from:"2026-09-01",to:"2026-09-30"}]})}]});
 mocks.list.mockImplementation(async (_u:string,from:string)=>{
  if(from==="2026-09-01") return [row("A","2026-09-05"),row("B","2026-09-20")];
  if(from==="2026-08-02") return [row("C","2026-08-15")];
  return [];
 });
 const answer=await answerFinanceQuery("analyze my spending behavior this month","u");
 expect(mocks.list).toHaveBeenNthCalledWith(1,"u","2026-09-01","2026-09-30");
 expect(mocks.list).toHaveBeenNthCalledWith(2,"u","2026-08-02","2026-08-31");
 expect(answer).toContain("### Spending analysis");
 expect(answer).toContain("$2.00");
 expect(answer).toContain("▲ 100%");
 expect(answer).toContain("$1.00");
});
it("analysis mode flags a same-amount, roughly-monthly merchant as a recurring charge, not a coincidence", async () => {
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({...plan,mode:"analysis",ranges:[{from:"2026-09-01",to:"2026-09-30"}]})}]});
 mocks.list.mockImplementation(async (_u:string,from:string)=>{
  if(from==="2026-09-01") return [{...row("Netflix","2026-09-10"),amountMinor:1599}];
  if(from==="2026-08-02") return [{...row("Netflix","2026-08-11"),amountMinor:1599}];
  return [];
 });
 const answer=await answerFinanceQuery("analyze my spending behavior","u");
 expect(answer).toContain("**Recurring charges**");
 expect(answer).toContain("Netflix: ~$15.99, monthly (2 charges seen)");
});
it("analysis mode skips the comparison for an all-time request instead of computing against 1970", async () => {
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({...plan,mode:"analysis",ranges:[{from:"1970-01-01",to:"2026-09-25"}]})}]});
 mocks.list.mockResolvedValue([row("A","2026-09-05")]);
 const answer=await answerFinanceQuery("analyze all my spending ever","u");
 expect(mocks.list).toHaveBeenCalledTimes(1);
 expect(answer).toContain("- **$1.00**");
 expect(answer).not.toContain("vs");
});
it("its JSON schema never uses minItems/maxItems on an array (Anthropic's structured output rejects that keyword, which silently broke every finance question until this was caught live)", () => {
  const walk = (node: unknown): string[] => {
    if (!node || typeof node !== "object") return [];
    const bad = Object.keys(node).filter((key) => key === "minItems" || key === "maxItems");
    return [...bad, ...Object.values(node as Record<string, unknown>).flatMap(walk)];
  };
  expect(walk(FINANCE_QUERY_JSON_SCHEMA)).toEqual([]);
});
