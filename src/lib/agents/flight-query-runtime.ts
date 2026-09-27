import { callClaude } from "@/lib/runtime/model-runtime";
import { extractFlightSlots } from "./flight-query";

export function extractFlightSlotsForUser(query: string, homeLocation: string | null, today: string, userId: string) {
  return extractFlightSlots(query, homeLocation, today, userId, (params) => callClaude("flight_slot_extraction", params, { userId }));
}
