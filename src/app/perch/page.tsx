import { FinanceSyncCard } from "@/components/today/FinanceSyncCard";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { RefreshOnReturn } from "@/components/today/RefreshOnReturn";
import { RepliesSection, RepliesSkeleton } from "@/components/today/RepliesSection";
import { TodayView } from "@/components/today/TodayView";
import { loadDaySummaryParts } from "@/lib/today/summary";
import { isPerchEnabled } from "@/lib/replies/dismissals";
import { listConversations } from "@/lib/conversations/store";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../auth/actions";

export const dynamic = "force-dynamic";
/** Perch reads the calendar, bills and mail. The reply card stops waiting after 8 seconds by itself; this is the outer limit. */
export const maxDuration = 30;

export default async function PerchPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : "Google connected";
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : undefined;
  // Perch was turned off in Settings: leave it out, and nothing is read.
  if (!(await isPerchEnabled(userId))) redirect("/");
  const summary = userId ? loadDaySummaryParts(userId) : null;
  const [view, recent] = userId ? await Promise.all([summary!.view, listConversations(userId, { limit: 40 }).catch(() => [])]) : [null, []];

  return <AppShell title="Perch" email={email} signOutAction={signOut} recent={recent} activeView="perch">
    {view && userId ? <><RefreshOnReturn /><FinanceSyncCard /><TodayView view={view} replies={<Suspense fallback={<RepliesSkeleton />}><RepliesSection userId={userId} result={summary!.replies} /></Suspense>} /></> : null}
  </AppShell>;
}
