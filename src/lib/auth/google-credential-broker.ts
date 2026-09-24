import { createAdminClient } from "@/lib/supabase/admin";
import { decryptText, encryptText } from "@/lib/security/encryption";
import { logEvent, reportFailure } from "@/lib/observability/report";

type Capability = "calendar" | "email" | "email_drafts";

const CAPABILITY_SCOPES: Record<Capability, readonly string[]> = {
  calendar: [
    "https://www.googleapis.com/auth/calendar.events",
  ],
  email: [
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  // R25: only present when a person grants it (see DRAFTS_ENABLED). Google has no drafts-only permission, so the guard in
  // tools/email/gmail-drafts.ts, not this scope, is what keeps Daylark from ever sending.
  email_drafts: [
    "https://www.googleapis.com/auth/gmail.compose",
  ],
};

export class GoogleConnectionRequiredError extends Error {
  constructor(public readonly capability: Capability) {
    super(`Google ${capability} connection required`);
    this.name = "GoogleConnectionRequiredError";
  }
}

export async function storeGoogleCredentials(userId: string, accessToken: string, refreshToken?: string | null) {
  const grantedScopes = await getGrantedScopes(accessToken);
  const capabilities = (Object.keys(CAPABILITY_SCOPES) as Capability[])
    .filter((capability) => CAPABILITY_SCOPES[capability].every((scope) => grantedScopes.has(scope)));
  await Promise.all(capabilities.map((capability) => storeGoogleCredential(userId, capability, accessToken, refreshToken)));
}

async function storeGoogleCredential(userId: string, capability: Capability, accessToken: string, refreshToken?: string | null) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("oauth_connections").select("refresh_token_ciphertext").eq("user_id", userId).eq("provider", "google").eq("capability", capability).maybeSingle();
  const { error } = await admin.from("oauth_connections").upsert({
    user_id: userId,
    provider: "google",
    capability,
    access_token_ciphertext: encryptText(accessToken),
    refresh_token_ciphertext: refreshToken ? encryptText(refreshToken) : existing?.refresh_token_ciphertext ?? null,
    scopes: CAPABILITY_SCOPES[capability],
    access_token_expires_at: new Date(Date.now() + 50 * 60 * 1_000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider,capability" });
  if (error) throw error;
}

async function getGrantedScopes(accessToken: string) {
  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("GOOGLE_TOKEN_INFO_UNAVAILABLE");
  const body = await response.json() as { scope?: string };
  return new Set((body.scope ?? "").split(/\s+/).filter(Boolean));
}

export async function withGoogleCredential<T>(userId: string, capability: Capability, operation: (accessToken: string) => Promise<T>): Promise<T> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("oauth_connections").select("access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, scopes").eq("user_id", userId).eq("provider", "google").eq("capability", capability).maybeSingle();
  if (error) throw error;
  if (!data) throw new GoogleConnectionRequiredError(capability);

  const granted = new Set(data.scopes as string[]);
  if (!CAPABILITY_SCOPES[capability].every((scope) => granted.has(scope))) throw new GoogleConnectionRequiredError(capability);

  let accessToken = decryptText(data.access_token_ciphertext as string);
  // Gets a new access token from the saved refresh token and stores it. Without a refresh token the person has to reconnect.
  const renew = async () => {
    if (!data.refresh_token_ciphertext) throw new GoogleConnectionRequiredError(capability);
    let renewed: string;
    try { renewed = await refreshGoogleAccessToken(decryptText(data.refresh_token_ciphertext as string), capability); }
    catch (error) { reportFailure("google_token_renew_failed", error, { capability }, { userId }); throw error; }
    const { error: updateError } = await admin.from("oauth_connections").update({
      access_token_ciphertext: encryptText(renewed),
      access_token_expires_at: new Date(Date.now() + 50 * 60 * 1_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider", "google").eq("capability", capability);
    if (updateError) throw updateError;
    return renewed;
  };
  if (new Date(data.access_token_expires_at as string).getTime() <= Date.now() + 60_000) accessToken = await renew();
  try {
    return await operation(accessToken);
  } catch (error) {
    // Google can reject a token that has not reached its expected expiry (revoked, or replaced by a newer sign-in). Renew once and try again
    // before asking the person to reconnect. A token that was renewed just now is not renewed twice.
    if (!isAuthRejected(error) || accessToken !== decryptText(data.access_token_ciphertext as string)) throw error;
    logEvent("info", "google_token_renewed", { capability, cause: "rejected" });
    return operation(await renew());
  }
}

/** The Google tools report a rejected token (401) as `insufficient_scope`. */
function isAuthRejected(error: unknown) {
  return error instanceof Error && (error as { reason?: string }).reason === "insufficient_scope";
}

async function refreshGoogleAccessToken(refreshToken: string, capability: Capability) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as {error?: string};
    if (failure.error === "invalid_grant" || response.status === 401) throw new GoogleConnectionRequiredError(capability);
    throw new Error("GOOGLE_TOKEN_REFRESH_UNAVAILABLE");
  }
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new GoogleConnectionRequiredError(capability);
  return body.access_token;
}
