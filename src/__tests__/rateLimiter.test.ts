/**
 * Tests for client-side rate limiter.
 * (Server-side rate limiter requires Next.js server runtime, tested via integration.)
 */
import {
  getCooldownRemaining,
  recordFaucetRequest,
  recordCooldown,
  canRequestFaucet,
  clearAllCooldowns,
} from "@/lib/rateLimiter";

beforeEach(() => {
  clearAllCooldowns();
});

describe("client rateLimiter", () => {
  describe("getCooldownRemaining", () => {
    it("returns 0 when no entry exists", () => {
      const remaining = getCooldownRemaining("GADDR123");
      expect(remaining).toBe(0);
    });

    it("returns remaining time after a request", () => {
      recordFaucetRequest("GADDR123");
      const remaining = getCooldownRemaining("GADDR123");
      // Should be positive and <= 60000
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60000);
    });

    it("returns 0 for different addresses", () => {
      recordFaucetRequest("GADDR123");
      const remaining = getCooldownRemaining("GADDR456");
      expect(remaining).toBe(0);
    });
  });

  describe("recordCooldown", () => {
    it("honors a shorter remaining window (server Retry-After)", () => {
      recordCooldown("GADDR123", 30_000);
      const remaining = getCooldownRemaining("GADDR123");
      // A 30s server cooldown must read back as ~30s, not the full 60s.
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(30_000);
      expect(remaining).toBeGreaterThan(25_000);
    });

    it("honors a longer remaining window than the local default", () => {
      // e.g. the server's Retry-After says 120s — the stored cooldown must
      // keep blocking past the local 60s default window.
      recordCooldown("GADDR123", 120_000);
      const remaining = getCooldownRemaining("GADDR123");
      expect(remaining).toBeGreaterThan(110_000);
      expect(canRequestFaucet("GADDR123")).toBe(false);
    });

    it("replaces an existing cooldown for the same address", () => {
      recordCooldown("GADDR123", 30_000);
      recordCooldown("GADDR123", 15_000);
      const remaining = getCooldownRemaining("GADDR123");
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(15_000);
    });

    it("does not leak to other addresses", () => {
      recordCooldown("GADDR123", 120_000);
      expect(getCooldownRemaining("GADDR456")).toBe(0);
    });
  });

  describe("canRequestFaucet", () => {
    it("allows first request", () => {
      expect(canRequestFaucet("GADDR123")).toBe(true);
    });

    it("blocks immediate second request", () => {
      recordFaucetRequest("GADDR123");
      expect(canRequestFaucet("GADDR123")).toBe(false);
    });
  });

  describe("clearAllCooldowns", () => {
    it("resets all cooldowns", () => {
      recordFaucetRequest("GADDR123");
      expect(canRequestFaucet("GADDR123")).toBe(false);

      clearAllCooldowns();
      expect(canRequestFaucet("GADDR123")).toBe(true);
    });
  });

  describe("expiry pruning", () => {
    it("drops expired entries so localStorage cannot grow without bound", () => {
      // Simulate a cooldown that has already fully elapsed.
      recordCooldown("GADDR123", 1);
      jest.spyOn(Date, "now").mockReturnValueOnce(Date.now() + 10_000);

      expect(getCooldownRemaining("GADDR123")).toBe(0);
      jest.restoreAllMocks();

      // The expired entry must no longer be persisted — storage holds only
      // live windows, so repeated faucet use can't accumulate history.
      const raw = window.localStorage.getItem("stellardripz_cooldowns");
      const stored = raw ? (JSON.parse(raw) as { address: string }[]) : [];
      expect(stored.find((e) => e.address === "GADDR123")).toBeUndefined();
    });

    it("keeps still-active entries while pruning expired ones", () => {
      // Write one live and one already-expired entry directly, so the test
      // doesn't depend on wall-clock timing.
      window.localStorage.setItem(
        "stellardripz_cooldowns",
        JSON.stringify([
          { address: "GADDR_ACTIVE", expiresAt: Date.now() + 60_000 },
          { address: "GADDR_EXPIRED", expiresAt: Date.now() - 1_000 },
        ]),
      );

      // A single read prunes only the expired entry.
      const remaining = getCooldownRemaining("GADDR_ACTIVE");
      expect(remaining).toBeGreaterThan(0);

      const raw = window.localStorage.getItem("stellardripz_cooldowns");
      const stored = raw ? (JSON.parse(raw) as { address: string }[]) : [];
      expect(stored.find((e) => e.address === "GADDR_ACTIVE")).toBeDefined();
      expect(stored.find((e) => e.address === "GADDR_EXPIRED")).toBeUndefined();
    });

    it("migrates legacy lastRequest entries written by older versions", () => {
      // Older versions stored { address, lastRequest } against a fixed 60s
      // window; the migration must read those back as still-active.
      window.localStorage.setItem(
        "stellardripz_cooldowns",
        JSON.stringify([{ address: "GADDR_LEGACY", lastRequest: Date.now() - 10_000 }]),
      );
      const remaining = getCooldownRemaining("GADDR_LEGACY");
      expect(remaining).toBeGreaterThan(40_000); // ~50s left of the 60s window
    });
  });
});
// Edge case: validates rate limit after multiple rapid requests
