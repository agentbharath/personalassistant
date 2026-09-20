import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { NEXT_COOKIE, safeNextPath } from "@/lib/auth/next-path";
import { createClient } from "@/lib/supabase/server";
import { storeGoogleCredentials } from "@/lib/auth/google-credential-broker";

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
      } catch (credentialError) {
        console.error("google_credential_store_failed", credentialError instanceof Error ? credentialError.message : "unknown");
      }
      const response = NextResponse.redirect(new URL(next, url.origin));
      response.cookies.set(NEXT_COOKIE, "", { path: "/", maxAge: 0 });
      return response;
    }
  }

  return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
}
