import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, Ref } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm"; block?: boolean; ref?: Ref<HTMLButtonElement> };

export function Button({ variant = "secondary", size = "md", block, className, type = "button", ...props }: Props) {
  return <button type={type} className={[styles.button, styles[variant], size === "sm" && styles.small, block && styles.block, className].filter(Boolean).join(" ")} {...props} />;
}

/** Icon-only buttons must have an accessible name, so `label` is required. */
export function IconButton({ label, variant = "ghost", size = "md", className, type = "button", children, ...props }: Omit<Props, "block"> & { label: string }) {
  return <button type={type} aria-label={label} title={label} className={[styles.button, styles[variant], styles.icon, size === "sm" && styles.iconSmall, className].filter(Boolean).join(" ")} {...props}>{children}</button>;
}

/** A link that looks like a button, for navigation. (A button inside a link is invalid HTML and confuses screen readers.) */
export function ButtonLink({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: "md" | "sm" }) {
  return <Link className={[styles.button, styles[variant], size === "sm" && styles.small, className].filter(Boolean).join(" ")} {...props} />;
}
