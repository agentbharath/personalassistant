import { beforeEach, expect, it, vi } from "vitest";
const complete=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/runtime/model-runtime",()=>({callClaude:complete}));
import { answerGeneral, synthesizeSearchResults } from "./claude";
import { DAYLARK_PERSONA } from "./persona";
import { FINANCIAL_GUIDANCE } from "./financial-guidance";
beforeEach(()=>complete.mockReset());
it("supplies financial limits and prior facts for an advice follow-up",async()=>{
  complete.mockResolvedValue({content:[{type:"text",text:"Compare the card's interest cost with your need for emergency cash."}]});
  const answer=await answerGeneral("Which should I do first?",[
    {role:"user",content:"I have $500 saved and a card balance. Help me choose debt payoff versus savings."},
    {role:"assistant",content:"Is the card on a promotional rate?",choices:["Yes","No"]},
    {role:"user",content:"No, its APR is 24%."},
  ]);
  expect(answer).toContain("interest cost");
  const request=complete.mock.calls[0][1];
  expect(request.system).toContain(FINANCIAL_GUIDANCE);
  expect(request.messages[0].content).toContain("24%");
  expect(request.messages[0].content).toContain("$500");
  expect(request.tools).toBeUndefined();
});
it("applies the same boundaries to web synthesis and includes retrieved evidence",async()=>{
  complete.mockResolvedValue({content:[{type:"text",text:JSON.stringify({kind:"answer",intro:"",items:[],answer:"Check eligibility before contributing.",caveat:""})}]});
  await synthesizeSearchResults("IRA contribution limits",[{title:"IRS",url:"https://www.irs.gov/retirement-plans",snippet:"Official retirement-plan rules."}]);
  expect(complete.mock.calls[0][1].system).toContain(FINANCIAL_GUIDANCE);
  expect(complete.mock.calls[0][1].messages[0].content).toContain("Official retirement-plan rules");
});
it("tells synthesis today's date and warns against presenting a differently-dated source as current, only when a date is given",async()=>{
  complete.mockResolvedValue({content:[{type:"text",text:JSON.stringify({kind:"answer",intro:"",items:[],answer:"x",caveat:""})}]});
  await synthesizeSearchResults("Thanksgiving in Colorado",[{title:"x",url:"https://x",snippet:"x"}],"","2026-09-24");
  expect(complete.mock.calls[0][1].system).toContain("Today is 2026-09-24");
  expect(complete.mock.calls[0][1].system).toContain("last cycle's information");
  complete.mockClear();
  await synthesizeSearchResults("Thanksgiving in Colorado",[{title:"x",url:"https://x",snippet:"x"}]);
  expect(complete.mock.calls[0][1].system).not.toContain("Today is");
});
it("requires requested advice, preserves uncertainty, and never authorizes money movement",()=>{
  expect(DAYLARK_PERSONA).toContain("only when the user asks");
  expect(FINANCIAL_GUIDANCE).toContain("Do not use a blanket");
  expect(FINANCIAL_GUIDANCE).toContain("Imported spending is not a bank balance");
  expect(FINANCIAL_GUIDANCE).toContain("Advice is read-only");
  expect(FINANCIAL_GUIDANCE).toContain("Never send private account details");
});
