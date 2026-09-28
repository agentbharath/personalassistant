import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Pages anyone may open without signing in. Everything else needs a session. */
export function isPublicPath(path: string, development: boolean) {
  return path === "/login" || path === "/privacy" || path === "/terms" || path === "/manifest.webmanifest"
    || path.startsWith("/auth/")
    || path === "/api/health"
    // Called by monitoring with a bearer token, not by a signed-in browser; the route checks the token itself.
    || path.startsWith("/api/ops/")
    || (development && path.startsWith("/design"));
}

export type AccessDecision = "allow" | "login" | "unauthorized" | "home";

/** What to do with a request: let it through, send a page request to sign in, answer an API request with 401 JSON, or send a signed-in visitor away from the login page. */
export function accessDecision(path: string, authenticated: boolean, development: boolean): AccessDecision {
  if (!authenticated && !isPublicPath(path, development)) return path.startsWith("/api/") ? "unauthorized" : "login";
  if (authenticated && path === "/login") return "home";
  return "allow";
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const decision = accessDecision(path, Boolean(data?.claims?.sub), process.env.NODE_ENV !== "production");

  if (decision === "unauthorized") return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (decision === "login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (decision === "home") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
