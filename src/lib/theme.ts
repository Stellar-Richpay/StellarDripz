/**
 * Theme preference helpers — pure functions shared by the useTheme hook and
 * the pre-paint inline script in the root layout.
 *
 * The preference is one of "light" | "dark" | "system" (default: system,
 * i.e. follow the OS `prefers-color-scheme`). The *resolved* theme is always
 * "light" or "dark" and is what gets written to `document.documentElement`
 * as `data-theme` + `color-scheme`, which the CSS variables in globals.css
 * key off.
 */
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "stellardripz_theme";

const PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

/** Read the persisted preference, tolerating unavailable/corrupt storage. */
export function getStoredThemePreference(): ThemePreference | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : null;
  } catch {
    return null;
  }
}

/** Persist the preference. Storage failures (private mode, disabled) are fine. */
export function storeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* storage unavailable — the preference just won't survive reloads */
  }
}

/** Whether the OS prefers a light color scheme (false when unavailable). */
export function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches === true;
}

/** Resolve a preference to a concrete theme. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return systemPrefersLight() ? "light" : "dark";
  return preference;
}

/** Apply a resolved theme to the document (no-op outside the browser). */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/**
 * Inline script (rendered beforeInteractive in the layout) that applies the
 * stored/system theme before first paint, so a light-mode visitor never sees
 * a dark flash. Kept dependency-free and duplicated inline on purpose — it
 * must run before React hydrates.
 */
export const THEME_INIT_SCRIPT = `(function () {
  try {
    var stored = null;
    try { stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}); } catch (e) {}
    var light = stored === "light"
      ? true
      : stored === "dark"
        ? false
        : !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    document.documentElement.dataset.theme = light ? "light" : "dark";
    document.documentElement.style.colorScheme = light ? "light" : "dark";
  } catch (e) {}
})();`;
