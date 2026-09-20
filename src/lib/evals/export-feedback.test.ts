import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decryptText } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Turns answers you rated "bad" into candidate eval rows. Runs only on request (`npm run feedback:export`),
 * reads your own data, calls no model, and writes to evals/candidates/, which is git-ignored because it holds private text.
 * A candidate has no `expect` yet: a person decides what the right behaviour was, then moves the row into a real dataset with a rule ID.
 */
const enabled = process.env.FEEDBACK_EXPORT === "run";

describe.skipIf(!enabled)("export bad-answer feedback as candidate eval rows", () => {
  it("writes evals/candidates/feedback.jsonl", async () => {
    const admin = createAdminClient();
    const { data: feedback, error } = await admin.from("message_feedback").select("user_id, conversation_id, sequence_number, note_ciphertext, created_at").eq("rating", -1).order("created_at", { ascending: true }).limit(500);
    if (error) throw error;
    const rows: string[] = [];
    for (const item of feedback ?? []) {
      const { data: messages } = await admin.from("conversation_messages").select("role, content_ciphertext, sequence_number")
        .eq("conversation_id", item.conversation_id).eq("user_id", item.user_id).lte("sequence_number", item.sequence_number).order("sequence_number", { ascending: false }).limit(2);
      const answer = messages?.find((message) => message.role === "assistant" && Number(message.sequence_number) === Number(item.sequence_number));
      const question = messages?.find((message) => message.role === "user");
      if (!answer?.content_ciphertext || !question?.content_ciphertext) continue;
      rows.push(JSON.stringify({
        id: `feedback-${String(item.conversation_id).slice(0, 8)}-${item.sequence_number}`,
        rule: "TODO: cite the rule this violates, or add one to RULES.md first",
        input: decryptText(question.content_ciphertext as string),
        answer: decryptText(answer.content_ciphertext as string),
        note: item.note_ciphertext ? decryptText(item.note_ciphertext as string) : "",
        expect: null,
        ratedAt: item.created_at,
      }));
    }
    mkdirSync("evals/candidates", { recursive: true });
    writeFileSync("evals/candidates/feedback.jsonl", rows.join("\n") + (rows.length ? "\n" : ""));
    expect(rows.length).toBeGreaterThanOrEqual(0);
    console.log(`Wrote ${rows.length} candidate row(s) to evals/candidates/feedback.jsonl`);
  });
});
