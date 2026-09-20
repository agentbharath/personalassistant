import { createClient } from "@/lib/supabase/client";
import { NEXT_COOKIE, safeNextPath } from "./next-path";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

/** Starts Google sign-in with every permission Daylark needs. Used to sign in and to reconnect. Returns true when it could not start. */
export async function startGoogleSignIn(next?: string) {
  // Remember where the visitor was headed. A short-lived cookie is used, not the redirect URL, because the provider only
  // accepts redirect URLs on its allow-list and would drop one carrying extra parameters.
  const target = safeNextPath(next);
  document.cookie = target === "/"
    ? `${NEXT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${NEXT_COOKIE}=${encodeURIComponent(target)}; Path=/; Max-Age=600; SameSite=Lax`;
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: GOOGLE_SCOPES, queryParams: { access_type: "offline", prompt: "consent" } },
  });
  return Boolean(error);
}
