export const NEXT_COOKIE = "daylark-next";

// Backslashes and control characters (0x00-0x1f, 0x7f) are never valid in a path we would send someone to.
const UNSAFE = new RegExp("[\\\\\\u0000-\\u001f\\u007f]");

/**
 * Where to send someone after signing in. Only a path inside this app is accepted; anything else (another site, a protocol-relative
 * `//host`, backslashes, control characters, the login page itself) becomes the home page, so a crafted link cannot redirect off-site.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  let path = value;
  try { path = decodeURIComponent(value); } catch { return "/"; }
  if (!path.startsWith("/") || path.startsWith("//") || UNSAFE.test(path)) return "/";
  if (path === "/login" || path.startsWith("/login?") || path.startsWith("/auth/")) return "/";
  return path;
}
