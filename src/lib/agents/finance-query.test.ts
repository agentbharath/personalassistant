import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({model:vi.fn(),list:vi.fn(),write:vi.fn()}));
vi.mock("@/lib/runtime/model-runtime",()=>({callClaude:mocks.model}));
vi.mock("@/lib/tools/finance/transactions",()=>({listTransactions:mocks.list,createTransactionCandidate:mocks.write}));
import { answerFinanceQuery } from "./finance-query";
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
