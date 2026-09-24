import { expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({load:vi.fn(),queue:vi.fn(),advance:vi.fn(),approval:vi.fn()}));
vi.mock("./store",()=>({enabled:()=>true,loadSync:mocks.load,queueSync:mocks.queue,freshnessLabel:()=>"Saved records only."}));
vi.mock("./runner",()=>({advanceFinanceSync:mocks.advance}));
vi.mock("@/lib/workflows/finance-import",()=>({createFinanceImportApproval:mocks.approval}));
import { financeFreshness } from "./review";
it.each(["queued","running","review","blocked","idle"])("returns coverage without scanning or forcing approval while %s",async status=>{
 mocks.load.mockResolvedValue({status});
 const result=await financeFreshness("u","chat");
 expect(result.review).toBe(false);
 expect(mocks.queue).not.toHaveBeenCalled();
 expect(mocks.advance).not.toHaveBeenCalled();
 expect(mocks.approval).not.toHaveBeenCalled();
});
