/**
 * Daylark has no symbol yet: the brand is the wordmark. `LogoMark` is only a plain "D" tile, used where a small square is required
 * (the tab and home-screen icon in src/app/icon.svg). To add a real logo later, replace `Wordmark`'s contents and the icon.
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="15" fill="var(--ink)" />
    <path fillRule="evenodd" fill="var(--bg)" d="M22 16h10a16 16 0 0 1 0 32H22z M29 22.5v19h3a9.5 9.5 0 0 0 0-19z" />
  </svg>;
}

export function Wordmark() {
  return <span style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", fontWeight: 600, letterSpacing: "-0.03em" }}>Daylark</span>;
}
