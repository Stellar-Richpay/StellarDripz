/**
 * Safe localStorage JSON helpers for browser-only modules.
 *
 * Five modules (walletKit, walletconnect, lobstr, rateLimiter,
 * addressBookService) each re-implemented the same guarded
 * getItem/parse and setItem/stringify wrappers that no-op when storage is
 * unavailable (SSR, privacy mode) or full. Centralize those here so the
 * guards and error handling are identical everywhere.
 */

/** Read and JSON.parse a localStorage key, returning null when absent/broken. */
export function storageGetJSON<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** JSON.stringify and write a localStorage key. Returns false when blocked. */
export function storageSetJSON(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Remove a localStorage key. Returns false when blocked. */
export function storageRemove(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
