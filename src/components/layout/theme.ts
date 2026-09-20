export type ThemePreference = "light" | "dark" | "system";

export const THEME_KEY = "daylark-theme";

/** Runs before first paint (inlined in <head>), so the page never flashes the wrong theme. */
export const themeInitScript = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.dataset.themePreference=p}catch(e){}})();`;

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "dark" || (preference === "system" && systemDark) ? "dark" : "light";
}

export function nextPreference(current: ThemePreference): ThemePreference {
  return current === "system" ? "light" : current === "light" ? "dark" : "system";
}
