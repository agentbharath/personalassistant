import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { signOut } from "@/app/auth/actions";
import { BankConnections } from "@/components/finance/BankConnections";
import { listConversations } from "@/lib/conversations/store";

export default async function BanksPage() {
  const { data, error } = await (await createClient()).auth.getClaims();
  if (error || typeof data?.claims?.sub !== "string") redirect("/login");
  const recent = await listConversations(data.claims.sub, { limit: 40 }).catch(() => []);
  return <AppShell title="Bank connections" email={typeof data.claims.email === "string" ? data.claims.email : "Signed in"} signOutAction={signOut} activeView="settings" recent={recent}>
    <BankConnections />
  </AppShell>;
}
