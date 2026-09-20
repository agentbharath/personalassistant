"use client";

import { useEffect, useState } from "react";
import { THEME_KEY, resolveTheme, type ThemePreference } from "@/components/layout/theme";
import styles from "./ThemePicker.module.css";

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemePicker() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    try { const stored = localStorage.getItem(THEME_KEY); setPreference(stored === "light" || stored === "dark" ? stored : "system"); } catch { /* keep system */ }
  }, []);

  function choose(next: ThemePreference) {
    setPreference(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* the choice just will not persist */ }
    document.documentElement.dataset.themePreference = next;
    document.documentElement.dataset.theme = resolveTheme(next, matchMedia("(prefers-color-scheme: dark)").matches);
  }

  return <div className={styles.group} role="radiogroup" aria-label="Theme">
    {OPTIONS.map((option) => <label key={option.value} className={`${styles.option} ${preference === option.value ? styles.selected : ""}`}>
      <input type="radio" name="theme" value={option.value} checked={preference === option.value} onChange={() => choose(option.value)} />{option.label}
    </label>)}
  </div>;
}
