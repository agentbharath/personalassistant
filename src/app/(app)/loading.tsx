import { LoadingShell } from "@/components/layout/LoadingShell";
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <LoadingShell>
    <div style={{ display: "grid", gap: "var(--s-5)", width: "100%", maxWidth: "var(--measure)", margin: "0 auto", padding: "var(--s-12) var(--s-4)" }}>
      <Skeleton width="55%" height="2rem" />
      <Skeleton width="85%" />
      <Skeleton width="70%" />
    </div>
  </LoadingShell>;
}
