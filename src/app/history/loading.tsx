import { LoadingShell } from "@/components/layout/LoadingShell";
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <LoadingShell>
    <div style={{ display: "grid", gap: "var(--s-4)", width: "100%", maxWidth: "var(--measure)", margin: "0 auto", padding: "var(--s-12) var(--s-4)" }}>
      <Skeleton width="40%" height="2rem" />
      {[0, 1, 2, 3, 4].map((row) => <Skeleton key={row} height="2.5rem" />)}
    </div>
  </LoadingShell>;
}
