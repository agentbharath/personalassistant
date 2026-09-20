"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { shouldRefreshOnReturn } from "./refresh-policy";

/**
 * Perch shows live data, and the browser keeps a visited page for a short time. When someone comes back to the tab after a minute or more,
 * ask for fresh data so meetings, bills and spending are current. It renders nothing and shows no spinner: the page updates in place.
 */
export function RefreshOnReturn() {
  const router = useRouter();
  const [, start] = useTransition();
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    function onChange() {
      if (document.visibilityState === "hidden") { hiddenAt.current = Date.now(); return; }
      if (shouldRefreshOnReturn(hiddenAt.current, Date.now())) start(() => router.refresh());
      hiddenAt.current = null;
    }
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [router]);

  return null;
}
