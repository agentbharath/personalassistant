import { callClaude } from "@/lib/runtime/model-runtime";
import { writeDraft, type WriterInput } from "./writer";

export function writeDraftForUser(userId: string, input: WriterInput) {
  return writeDraft(input, { complete: (params) => callClaude("draft_write", params, { userId }) });
}
