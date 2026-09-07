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
});
// Edge case: validates rate limit after multiple rapid requests
