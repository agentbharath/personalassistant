import { callClaude } from "@/lib/runtime/model-runtime";
import { createInterpretationCache } from "./email-interpreter-runtime";
import { judgeReply, type ReplyJudgeInput } from "./reply-needed";

const cache = createInterpretationCache();

export function judgeReplyForUser(input: ReplyJudgeInput) {
  return judgeReply(input, { complete: (params) => callClaude("reply_needed", params), cache });
}
