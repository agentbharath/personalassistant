import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WriterInput, WrittenDraft } from "@/lib/drafts/writer";

export type DraftCase = {
  id: string;
  input: WriterInput;
  /** Form checks only, all compared without case. Whether a draft is good is for the owner to judge; these catch the failures that matter: inventing, leaking, obeying an email, ignoring the instruction. */
  check: { includes?: string[]; excludes?: string[]; maxWords?: number; subjectStartsWith?: string; subjectNotContains?: string; subjectIncludes?: string; shorterThanCurrent?: boolean; keepSubject?: boolean };
};

export function loadDraftCases(): DraftCase[] {
  return readFileSync(resolve(process.cwd(), "evals", "draft.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as DraftCase);
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function checkDraft(draft: WrittenDraft | null, item: DraftCase): string[] {
  if (!draft) return ["no usable draft came back (the model failed, or it left a placeholder)"];
  const { check } = item;
  const problems: string[] = [];
  const body = draft.body.toLowerCase();
  for (const text of check.includes ?? []) if (!body.includes(text.toLowerCase())) problems.push(`body should include “${text}”`);
  for (const text of check.excludes ?? []) if (body.includes(text.toLowerCase()) || draft.subject.toLowerCase().includes(text.toLowerCase())) problems.push(`should not include “${text}”`);
  if (check.maxWords && words(draft.body) > check.maxWords) problems.push(`body has ${words(draft.body)} words, more than ${check.maxWords}`);
  if (check.subjectStartsWith && !draft.subject.toLowerCase().startsWith(check.subjectStartsWith.toLowerCase())) problems.push(`subject should start with “${check.subjectStartsWith}”, got “${draft.subject}”`);
  if (check.subjectNotContains && draft.subject.toLowerCase().includes(check.subjectNotContains.toLowerCase())) problems.push(`subject should not contain “${check.subjectNotContains}”: “${draft.subject}”`);
  if (check.subjectIncludes && !draft.subject.toLowerCase().includes(check.subjectIncludes.toLowerCase())) problems.push(`subject should include “${check.subjectIncludes}”: “${draft.subject}”`);
  if (item.input.kind === "edit") {
    if (check.shorterThanCurrent && words(draft.body) >= words(item.input.current.body)) problems.push("the edit should be shorter than the current draft");
    if (check.keepSubject && draft.subject.trim() !== item.input.current.subject.trim()) problems.push(`the subject should stay “${item.input.current.subject}”, got “${draft.subject}”`);
  }
  return problems;
}
