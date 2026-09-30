import { describe, expect, it } from "vitest";
import { assistantConversationText, clipTurn, offeredChips, recentContext } from "./context";
import { embedCard } from "@/lib/chat/card-payload";
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

it("removes only assistant presentation payloads while preserving the prose and user content",()=>{
 const content='Today has two meetings.\n\n```daylark-card\n{"kind":"day","timeline":[]}\n```';
 const result=recentContext([{role:"assistant",content},{role:"user",content}]);
 expect(result[0].content).toBe("Today has two meetings.");
 expect(result[1].content).toBe(content);
});

describe("offered follow-up chips (free)", () => {
  const card = (chips: unknown) => embedCard("### Jackets\n\n**A** — $24", { kind: "suggestion", kindLabel: "Jackets", freshness: "", topPick: { name: "A", meta: "", metric: "$24", edgeTag: null, reason: "", actionLabel: "", actionUrl: "" }, rows: [], limit: "", sources: [], chips } as never);
  it("lists the exact messages each chip sends, for both string chips and message chips, skipping link-only chips", () => {
    expect(offeredChips(card(["Under $40", "Are they good?"]))).toEqual(["Under $40", "Are they good?"]);
    const score = embedCard("### Match", { kind: "score", match: "m", status: { label: "Final", tone: "final" }, teams: [{ name: "A", score: "1", detail: "", lead: true }, { name: "B", score: "0", detail: "", lead: false }], outcome: null, tables: [], facts: [], sources: [], chips: [{ label: "Full scorecard", url: "https://espn.com" }, { label: "Other cricket today", text: "Any cricket scores today?" }] });
    expect(offeredChips(score)).toEqual(["Any cricket scores today?"]);
    expect(offeredChips("plain text")).toEqual([]);
  });
  it("tells the router which buttons a card offered, next to its kind", () => {
    const text = assistantConversationText(card(["Half-zip vs quarter-zip styles"]));
    expect(text).toContain('[Tappable follow-ups this answer offered: "Half-zip vs quarter-zip styles"]');
    expect(text).toContain("suggestions card");
  });
  it("adds nothing for an answer with no buttons", () => {
    expect(assistantConversationText(card([]))).not.toContain("Tappable");
  });
});
