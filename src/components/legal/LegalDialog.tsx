"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/icons";
import { LegalSwitchContext, type LegalDoc } from "./DocLink";
import dialogStyles from "./LegalDialog.module.css";
import pageStyles from "./LegalPage.module.css";
import { PrivacyContent } from "./PrivacyContent";
import { TermsContent } from "./TermsContent";

const TITLES: Record<LegalDoc, string> = { privacy: "Privacy Policy", terms: "Terms of Service" };

/**
 * Buttons that open the privacy policy or terms in a dialog, so nobody has to leave the page they are on.
 * `children` receives the openers, so the same dialog serves the login page and Settings.
 */
export function LegalDialogs({ children }: { children: (open: (doc: LegalDoc) => void) => ReactNode }) {
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  function open(next: LegalDoc) {
    if (!doc) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDoc(next);
  }
  function close() {
    setDoc(null);
    const target = opener.current;
    requestAnimationFrame(() => target?.focus());
  }

  return <>
    {children(open)}
    {doc && <Dialog doc={doc} onClose={close} onSwitch={setDoc} />}
  </>;
}

function Dialog({ doc, onClose, onSwitch }: { doc: LegalDoc; onClose: () => void; onSwitch: (doc: LegalDoc) => void }) {
  const panel = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden"; // the page behind should not scroll
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? []);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.documentElement.style.overflow = previousOverflow; };
  }, [onClose]);

  // Switching document starts at the top.
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [doc]);

  return <div className={dialogStyles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className={dialogStyles.dialog} role="dialog" aria-modal="true" aria-labelledby="legal-title">
      <header className={dialogStyles.head}>
        <h2 id="legal-title" className={dialogStyles.title}>{TITLES[doc]}</h2>
        <IconButton size="sm" label="Close" onClick={onClose}><CloseIcon /></IconButton>
      </header>
      <div className={dialogStyles.scroll} ref={scroller} tabIndex={-1}>
        <LegalSwitchContext.Provider value={onSwitch}>
          <div className={`${pageStyles.body} ${dialogStyles.body}`}>{doc === "privacy" ? <PrivacyContent /> : <TermsContent />}</div>
        </LegalSwitchContext.Provider>
      </div>
    </section>
  </div>;
}
