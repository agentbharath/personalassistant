import { loadWaitingReplies } from "@/lib/replies/waiting";
import { WaitingCard } from "./WaitingCard";

/** Loads on its own behind a Suspense boundary, so judging mail never delays the rest of the page. */
export async function RepliesSection({ userId }: { userId: string }) {
  return <WaitingCard result={await loadWaitingReplies(userId)} />;
}
