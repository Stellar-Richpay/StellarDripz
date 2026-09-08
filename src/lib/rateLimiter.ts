/**
 * Per-address rate limiter for faucet requests.
 * Uses localStorage for persistence.
 */
import { storageGetJSON, storageRemove, storageSetJSON } from "./storage";

const STORAGE_KEY = "stellardripz_cooldowns";

interface CooldownEntry {
  address: string;
  /** Epoch ms when the cooldown expires. Absent on entries written by older
   * versions, which stored a synthetic `lastRequest` against a fixed 60s
   * window — see migrateEntry below. */
  expiresAt?: number;
  /** Legacy field from older versions: epoch ms of the request. */
  lastRequest?: number;
}

function getAll(): CooldownEntry[] {
  const entries = storageGetJSON<CooldownEntry[]>(STORAGE_KEY) ?? [];

  const now = Date.now();
  // Prune expired entries. Older versions never removed them, so repeated
  // faucet use made this array (and thus localStorage) grow without bound,
  // and every read scanned the full history. Only the still-active windows
  // are worth persisting.
  const active = entries.filter((e) => {
    const expiresAt = resolveExpiry(e, now);
    return expiresAt > now;
  });

  // Persist the pruned set only when something actually changed, so steady
  // reads (CooldownTimer ticks every second) don't rewrite storage.
  if (active.length !== entries.length) {
    saveAll(active);
  }

  return active;
}

/** Absolute expiry for an entry, migrating the legacy synthetic timestamp. */
function resolveExpiry(entry: CooldownEntry, now: number): number {
  if (typeof entry.expiresAt === "number") return entry.expiresAt;
  // Legacy entries stored lastRequest computed as now - (60000 - remainingMs),
  // i.e. the exact moment the 60s window would have started.
  if (typeof entry.lastRequest === "number") return entry.lastRequest + 60_000;
  return now; // unreadable entry — treat as expired
}

function saveAll(entries: CooldownEntry[]): void {
  storageSetJSON(STORAGE_KEY, entries);
}

/** Check if an address is within the cooldown period. Returns remaining ms or 0. */
export function getCooldownRemaining(address: string, cooldownMs: number = 60_000): number {
  const entry = getAll().find((e) => e.address === address);
  if (!entry) return 0;

  const remaining = resolveExpiry(entry, Date.now()) - Date.now();
  // cooldownMs is kept for API compatibility; a stored cooldown always wins
  // over the default window (it may have been set from a server Retry-After).
  return Math.max(0, remaining);
}

/** Record a faucet request for an address (full cooldown window starts now). */
export function recordFaucetRequest(address: string, cooldownMs: number = 60_000): void {
  recordCooldown(address, cooldownMs);
}

/**
 * Record a cooldown that expires in `remainingMs` (may be shorter or longer
 * than the default window, e.g. when the server returns a Retry-After
 * header). Stored as an absolute expiry so any later read returns the exact
 * remaining time regardless of the caller's default window.
 */
export function recordCooldown(address: string, remainingMs: number): void {
  const active = getAll().filter((e) => e.address !== address);
  active.push({ address, expiresAt: Date.now() + remainingMs });
  saveAll(active);
}

/** Check if an address can request faucet funds right now. */
export function canRequestFaucet(address: string, cooldownMs?: number): boolean {
  return getCooldownRemaining(address, cooldownMs) === 0;
}

/** Clear all cooldowns (for dev/testing). */
export function clearAllCooldowns(): void {
  storageRemove(STORAGE_KEY);
}
