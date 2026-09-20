import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Wordmark } from "@/components/ui/Logo";
import shell from "./AppShell.module.css";
import sidebar from "./Sidebar.module.css";

/**
 * What every page shows while it loads: the same sidebar and top-bar frame the real page has, with placeholders where the data will be.
 * Because the frame does not change between loading and loaded, nothing (the logo included) disappears and reappears.
 */
export function LoadingShell({ children }: { children: ReactNode }) {
  return <div className={shell.shell}>
    <span className="sr-only" role="status">Loading</span>
    <div className={shell.sidebarWrap}>
      <div className={sidebar.sidebar}>
        <div className={sidebar.brand}><Wordmark /></div>
        <Skeleton height="2.25rem" radius="var(--r-sm)" />
        <div style={{ display: "grid", gap: "var(--s-3)", marginTop: "var(--s-6)" }}>
          {[80, 64, 72, 56, 68, 60].map((width, index) => <Skeleton key={index} width={`${width}%`} height="0.9rem" />)}
        </div>
      </div>
    </div>
    <div className={shell.workspace}>
      <header className={shell.topbar}><Skeleton width="10rem" height="1rem" /></header>
      <main className={shell.main}>{children}</main>
    </div>
  </div>;
}
