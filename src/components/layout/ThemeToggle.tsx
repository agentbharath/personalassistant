"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/ui/icons";
import { THEME_KEY, nextPreference, resolveTheme, type ThemePreference } from "./theme";

const LABEL: Record<ThemePreference, string> = { system: "system", light: "light", dark: "dark" };

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    setPreference(stored === "light" || stored === "dark" ? stored : "system");
  }, []);

  useEffect(() => {
    if (preference !== "system") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = resolveTheme("system", query.matches); };
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preference]);

  function cycle() {
    const next = nextPreference(preference);
    setPreference(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: the choice just will not persist */ }
    document.documentElement.dataset.themePreference = next;
    document.documentElement.dataset.theme = resolveTheme(next, matchMedia("(prefers-color-scheme: dark)").matches);
  }

  const Icon = preference === "dark" ? MoonIcon : preference === "light" ? SunIcon : MonitorIcon;
  return <IconButton label={`Theme: ${LABEL[preference]}. Switch to ${LABEL[nextPreference(preference)]}.`} onClick={cycle}><Icon /></IconButton>;
}
