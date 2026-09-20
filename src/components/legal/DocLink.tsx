"use client";

import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";

export type LegalDoc = "privacy" | "terms";

/** Inside the dialog, a link to the other document switches the dialog instead of leaving the page. */
export const LegalSwitchContext = createContext<((doc: LegalDoc) => void) | null>(null);

export function DocLink({ doc, children }: { doc: LegalDoc; children: ReactNode }) {
  const switchTo = useContext(LegalSwitchContext);
  if (switchTo) return <a href={`/${doc}`} onClick={(event) => { event.preventDefault(); switchTo(doc); }}>{children}</a>;
  return <Link href={{ pathname: `/${doc}` }}>{children}</Link>;
}
