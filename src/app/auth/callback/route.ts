import { enabled, queueSync } from "@/lib/finance-sync/store";
import { advanceFinanceSync } from "@/lib/finance-sync/runner";
import { withRequestContext } from "@/lib/runtime/request-context";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { NEXT_COOKIE, safeNextPath } from "@/lib/auth/next-path";
import { createClient } from "@/lib/supabase/server";
import { storeGoogleCredentials } from "@/lib/auth/google-credential-broker";
import { reportFailure } from "@/lib/observability/report";

export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // The page the visitor was headed to before signing in, remembered in a cookie by the login page. Always checked before use.
  const jar = await cookies();
  const next = safeNextPath(jar.get(NEXT_COOKIE)?.value ?? url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session?.provider_token) {
      try {
        await storeGoogleCredentials(data.session.user.id, data.session.provider_token, data.session.provider_refresh_token);
        if (enabled()) {
          const userId = data.session.user.id;
          after(async () => {
            try {
              await queueSync(userId);
              await withRequestContext({userId, requestId: randomUUID(), startedAt: Date.now(), deadlineAt: Date.now() + 45000, costLimitUsd: 0.15}, () => advanceFinanceSync(userId, 40000));
            } catch (error) { reportFailure("finance_initial_sync_failed", error, {}, {userId}); }
          });
        }
      } catch (credentialError) {
        reportFailure("google_credential_store_failed", credentialError, {}, { level: "error", userId: data.session.user.id });
      }
      const response = NextResponse.redirect(new URL(next, url.origin));
      response.cookies.set(NEXT_COOKIE, "", { path: "/", maxAge: 0 });
      return response;
    }
  }

  return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
}
