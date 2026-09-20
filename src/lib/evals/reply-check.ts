import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReplyJudgement } from "@/lib/agents/reply-needed";

export type ReplyCase = { id: string; from: string; subject: string; text: string; expect: { needsReply: boolean } };

export function loadReplyCases(): ReplyCase[] {
  return readFileSync(resolve(process.cwd(), "evals", "reply.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ReplyCase);
}

export function checkReply(result: ReplyJudgement | null, expected: ReplyCase["expect"]): string[] {
  if (!result) return ["the model call failed"];
  const problems: string[] = [];
  if (result.needsReply !== expected.needsReply) problems.push(`needsReply ${result.needsReply}, wanted ${expected.needsReply}`);
  if (expected.needsReply && result.needsReply && !result.reason.trim()) problems.push("needs a reply but gave no reason");
  return problems;
}
