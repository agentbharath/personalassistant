import { describe, expect, it } from "vitest";
import { followupContext, repeatsAnsweredQuestion } from "./followup";
import { recentContext, type ContextTurn } from "./context";
const question: ContextTurn = { role: "assistant", content: "Daylark drafts or Gmail drafts?", choices: ["Daylark's saved drafts", "Gmail drafts"] };
describe("follow-up exchange", () => {
  it("preserves the question and exact selection after context is loaded again", () => {
    const context: ContextTurn[] = [{role:"user", content:"What emails have we drafted?"}, question];
    expect(followupContext(recentContext(context), "Daylark’s saved drafts")).toMatchObject({precedingRequest:"What emails have we drafted?", offeredChoices:question.choices, selectedChoice:"Daylark's saved drafts"});
    expect(repeatsAnsweredQuestion(question.content, context, "Daylark's saved drafts")).toBe(true);
  });
  it("does not choose between alternatives for a bare yes", () => {
    expect(followupContext([question], "yes")?.selectedChoice).toBeNull();
    expect(repeatsAnsweredQuestion(question.content, [question], "yes")).toBe(false);
  });
  it("stops an unresolved question from cycling repeatedly", () => {
    expect(repeatsAnsweredQuestion(question.content, [question, {role:"user", content:"The ones you created"}, question], "The ones you created")).toBe(true);
  });
  it("allows a different necessary question and does not resurrect old questions", () => {
    expect(repeatsAnsweredQuestion("Which recipient?", [question], "Gmail drafts")).toBe(false);
    expect(repeatsAnsweredQuestion(question.content, [question, question, {role:"assistant",content:"What day should we meet?"}], "Friday")).toBe(false);
  });
  it("preserves a new request instead of pretending it selects an old option", () => {
    expect(followupContext([question], "What's my calendar tomorrow?")?.selectedChoice).toBeNull();
  });
});
