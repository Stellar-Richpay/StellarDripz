import {
  applyTheme,
  getStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  systemPrefersLight,
  THEME_STORAGE_KEY,
  THEME_INIT_SCRIPT,
} from "@/lib/theme";

/** Stub prefers-color-scheme for the system-resolution tests. */
function setPrefersLight(matches: boolean): void {
  (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = jest
    .fn()
    .mockReturnValue({ matches });
}

describe("theme lib", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    setPrefersLight(false);
  });

  it("reads back a stored preference", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(getStoredThemePreference()).toBe("light");
  });

  it("returns null for missing or corrupt stored preferences", () => {
    expect(getStoredThemePreference()).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(getStoredThemePreference()).toBeNull();
  });

  it("persists a preference", () => {
    storeThemePreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("resolves explicit preferences directly", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves system preference via prefers-color-scheme", () => {
    expect(systemPrefersLight()).toBe(false);
    expect(resolveTheme("system")).toBe("dark");
    setPrefersLight(true);
    expect(systemPrefersLight()).toBe(true);
    expect(resolveTheme("system")).toBe("light");
  });

  it("applyTheme stamps data-theme and color-scheme", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("the init script pins the theme before paint", () => {
    expect(THEME_INIT_SCRIPT).toContain('localStorage.getItem("stellardripz_theme")');
    expect(THEME_INIT_SCRIPT).toContain("document.documentElement.dataset.theme");
    expect(THEME_INIT_SCRIPT).toContain("prefers-color-scheme: light");
  });
});
