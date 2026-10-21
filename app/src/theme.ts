// Purpose: light dark and contrast themes
import { useCallback, useEffect, useState } from "react";

export const THEMES = [
  { id: "paper", label: "Light" },
  { id: "night", label: "Dark" },
  { id: "contrast", label: "High contrast" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type Motion = "auto" | "reduced";

const THEME_KEY = "pn_theme";
const MOTION_KEY = "pn_motion";

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function applyTheme(theme: string, motion: string): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.motion = motion;
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const raw = read(THEME_KEY, "paper");
    return (THEMES.some((t) => t.id === raw) ? raw : "paper") as ThemeId;
  });
  const [motion, setMotionState] = useState<Motion>(() => (read(MOTION_KEY, "auto") === "reduced" ? "reduced" : "auto"));

  useEffect(() => {
    applyTheme(theme, motion);
    try {
      localStorage.setItem(THEME_KEY, theme);
      localStorage.setItem(MOTION_KEY, motion);
    } catch {
      /* per-viewer convenience only */
    }
  }, [theme, motion]);

  const setTheme = useCallback((id: ThemeId) => setThemeState(id), []);
  const setMotion = useCallback((m: Motion) => setMotionState(m), []);
  return { theme, setTheme, motion, setMotion };
}
