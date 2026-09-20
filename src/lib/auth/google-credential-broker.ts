import { createAdminClient } from "@/lib/supabase/admin";
import { decryptText, encryptText } from "@/lib/security/encryption";

type Capability = "calendar" | "email";

const CAPABILITY_SCOPES: Record<Capability, readonly string[]> = {
  calendar: [
    "https://www.googleapis.com/auth/calendar.events",
  ],
  email: [
    "https://www.googleapis.com/auth/gmail.readonly",
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
  if (new Date(data.access_token_expires_at as string).getTime() <= Date.now() + 60_000) {
    if (!data.refresh_token_ciphertext) throw new GoogleConnectionRequiredError(capability);
    accessToken = await refreshGoogleAccessToken(decryptText(data.refresh_token_ciphertext as string), capability);
    const { error: updateError } = await admin.from("oauth_connections").update({
      access_token_ciphertext: encryptText(accessToken),
      access_token_expires_at: new Date(Date.now() + 50 * 60 * 1_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider", "google").eq("capability", capability);
    if (updateError) throw updateError;
  }
  return operation(accessToken);
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
  if (!response.ok) throw new GoogleConnectionRequiredError(capability);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new GoogleConnectionRequiredError(capability);
  return body.access_token;
}
