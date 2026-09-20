export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: size, height: size, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-ink)", fontFamily: "var(--font-display)", fontSize: size * 0.46, fontWeight: 500, flex: "0 0 auto" }}>{name.trim().charAt(0).toUpperCase() || "D"}</span>;
}
