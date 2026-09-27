import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";
import { signOut } from "@/app/auth/actions";
import { BankConnections } from "@/components/finance/BankConnections";

export default async function BanksPage() {
  const { data, error } = await (await createClient()).auth.getClaims();
  if (error || typeof data?.claims?.sub !== "string") redirect("/login");
  return <AppShell title="Bank connections" email={typeof data.claims.email === "string" ? data.claims.email : "Signed in"} signOutAction={signOut} activeView="settings" recent={[]}>
    <BankConnections />
  </AppShell>;
}
