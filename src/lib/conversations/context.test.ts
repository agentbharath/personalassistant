import { expect, it } from "vitest";
import { clipTurn, recentContext } from "./context";
it("keeps the task and final offer when a long turn must be shortened",()=>{
  const text="Sudoku JavaScript solver. "+"x".repeat(4000)+" Want me to search for it?";
  const result=clipTurn(text,500);
  expect(result.length).toBe(500);expect(result).toContain("Sudoku JavaScript");expect(result).toContain("Want me to search for it?");
});
it("bounds total context and keeps the latest reply",()=>{
  const result=recentContext(Array.from({length:30},(_,i)=>({role:"assistant" as const,content:`${i} start `+"x".repeat(6000)+` end ${i}`})),3000);
  expect(result.reduce((sum,turn)=>sum+turn.content.length,0)).toBeLessThanOrEqual(3000);
  expect(result.at(-1)?.content).toContain("end 29");
});
