import { z } from "zod";
import type { CardChip } from "./card-payload";
import { plain } from "@/lib/agents/search-answer";

const purposes = ["narrow", "deeper", "act", "widen"] as const;
export const cardFollowUpSchema = z.union([z.string(), z.object({ label: z.string(), text: z.string(), purpose: z.enum(purposes) })]);
export const CARD_FOLLOW_UP_JSON_SCHEMA = {
  type: "array", items: {
    type: "object", additionalProperties: false, required: ["label", "text", "purpose"],
    properties: { label: { type: "string" }, text: { type: "string" }, purpose: { type: "string", enum: [...purposes] } },
  },
};
export const CARD_FOLLOW_UP_RULES = `chips: up to four objects, at most one per purpose: narrow, deeper, act, widen, in that order. Each has a short label (3-5 words), a complete self-contained text to send, and purpose. Act means a supported handoff such as creating a calendar event or saving a preference, never a purchase, booking, reminder, alarm or price watch (unavailable). Omit a purpose when no useful supported follow-up exists; never invent one to fill four slots.`;

/** Preserve older string chips while storing full executable text separately from the short visible label. */
export function cleanCardFollowUps(chips: z.infer<typeof cardFollowUpSchema>[]): CardChip[] {
  const used = new Set<string>();
  return chips.flatMap((chip): CardChip[] => {
    if (typeof chip === "string") return chip.trim() ? [plain(chip, 40)] : [];
    if (!chip.label.trim() || !chip.text.trim() || used.has(chip.purpose)) return [];
    used.add(chip.purpose);
    return [{ label: plain(chip.label, 40), text: chip.text.trim(), purpose: chip.purpose, act: chip.purpose === "act" }];
  }).sort((a, b) => (typeof a === "string" ? 0 : purposes.indexOf(a.purpose!)) - (typeof b === "string" ? 0 : purposes.indexOf(b.purpose!))).slice(0, 4);
}
