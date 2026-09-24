import { loadDailyView } from "./load";
import { loadWaitingReplies } from "@/lib/replies/waiting";
/** Shared sources, with independent promises so Perch can continue streaming its reply section. */
export function loadDaySummaryParts(userId: string) {
 return {view: loadDailyView(userId), replies: loadWaitingReplies(userId)};
}
export async function buildDaySummary(userId: string) {
 const parts = loadDaySummaryParts(userId);
 const [view, replies] = await Promise.all([parts.view, parts.replies]);
 return {view, replies};
}
export type DaySummary = Awaited<ReturnType<typeof buildDaySummary>>;
