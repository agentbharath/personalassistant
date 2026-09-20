import { callClaude } from "@/lib/runtime/model-runtime";
import { createInterpretationCache } from "./email-interpreter-runtime";
import { judgeReply, readCachedJudgement, type ReplyJudgeInput } from "./reply-needed";

const cache = createInterpretationCache();

export function judgeReplyForUser(input: ReplyJudgeInput) {
  return judgeReply(input, { complete: (params) => callClaude("reply_needed", params), cache });
}

/** A remembered judgement, if any. Checked before mail is read, so a message that was already judged costs no Gmail call and no model call. */
export function peekReplyJudgement(userId: string, messageId: string) {
  return readCachedJudgement({ userId, messageId }, cache);
}
