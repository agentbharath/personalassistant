import { AppShell } from "@/components/layout/AppShell";
import { TodayView } from "@/components/today/TodayView";
import { loadDailyView } from "@/lib/today/load";
import { listConversations } from "@/lib/conversations/store";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../auth/actions";

export const dynamic = "force-dynamic";

export default async function PerchPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : "Google connected";
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : undefined;
  const [view, recent] = userId ? await Promise.all([loadDailyView(userId), listConversations(userId, { limit: 40 }).catch(() => [])]) : [null, []];

  return <AppShell title="Perch" email={email} signOutAction={signOut} recent={recent} activeView="perch">
    {view ? <TodayView view={view} /> : null}
  </AppShell>;
}
