"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  getStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

/**
 * Light/dark/system theme state with persistence and system-preference
 * detection.
 *
 * - Defaults to "system" (follow the OS) when nothing is stored.
 * - Persists explicit choices to localStorage (stellardripz_theme).
 * - While in "system" mode, live-updates when the OS scheme changes.
 * - Applies the resolved theme as `data-theme` + `color-scheme` on <html>,
 *   which the CSS-variable tokens in tailwind.config/globals.css key off.
 *
 * The initial resolved value is pinned to "dark" so server and client render
 * identically (no hydration mismatch); the effect corrects it immediately
 * after mount. The pre-paint inline script in the layout already set the
 * correct theme on <html>, so there is no visual flash.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => getStoredThemePreference() ?? "system",
  );
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const next = resolveTheme(preference);
    applyTheme(next);
    setResolved(next);
    storeThemePreference(preference);
  }, [preference]);

  // Follow OS scheme changes while in system mode.
  useEffect(() => {
    if (preference !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const next = resolveTheme("system");
      applyTheme(next);
      setResolved(next);
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
  }, []);

  return { preference, resolved, setPreference };
}
