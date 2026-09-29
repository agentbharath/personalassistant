import { callClaude } from "@/lib/runtime/model-runtime";
import { extractSportsSlots } from "./sports-query";

export function extractSportsSlotsForUser(query: string, userId: string) {
  return extractSportsSlots(query, (params) => callClaude("sports_slot_extraction", params, { userId }));
}
