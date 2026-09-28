/** Script nonces follow Next's dynamic rendering and Plaid Link CSP guidance. */
export function contentSecurityPolicy(nonce: string, development: boolean) {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const backend = supabase ? new URL(supabase).origin : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cdn.plaid.com${development ? " 'unsafe-eval'" : ""}`,
    // Existing UI and Plaid use inline style attributes. No inline JavaScript is permitted.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://cdn.plaid.com",
    "font-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'",
    "frame-ancestors 'none'", "frame-src https://cdn.plaid.com",
    `connect-src 'self' ${backend} https://production.plaid.com https://sandbox.plaid.com${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
