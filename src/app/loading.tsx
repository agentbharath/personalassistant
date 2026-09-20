import { Skeleton } from "@/components/ui/Skeleton";

/** Fallback for pages without a frame of their own (sign-in, privacy, terms): calm placeholders, no logo. */
export default function Loading() {
  return <div role="status" aria-label="Loading" style={{ display: "grid", gap: "var(--s-5)", width: "100%", maxWidth: "var(--measure)", margin: "0 auto", padding: "var(--s-16) var(--s-4)" }}>
    <Skeleton width="45%" height="2rem" />
    <Skeleton width="85%" />
    <Skeleton width="65%" />
  </div>;
}
