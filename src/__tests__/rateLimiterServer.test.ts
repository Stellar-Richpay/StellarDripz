/**
 * Tests for the server-side rate limiter (src/lib/server/rateLimiter.ts).
 *
 * Covers:
 *   - Client IP trust ordering (request.ip > x-real-ip > x-forwarded-for),
 *     which prevents attackers from rotating a spoofed header to bypass
 *     per-IP buckets.
 *   - Mainnet deployments applying the stricter mainnet rate limits.
 */
jest.mock("next/server", () => ({
  NextRequest: class {
    ip?: string;
    url: string;
    private headersObj: Record<string, string>;
    constructor(url: string, init?: { headers?: Record<string, string>; ip?: string }) {
      this.url = url;
      this.headersObj = init?.headers || {};
      this.ip = init?.ip;
    }
    get headers() {
      return {
        get: (name: string) => this.headersObj[name.toLowerCase()] ?? null,
      };
    }
  },
  NextResponse: class {
    status = 200;
    headers: { set: (k: string, v: string) => void; get: (k: string) => string | null };
    constructor() {
      const store = new Map<string, string>();
      this.headers = {
        set: (k: string, v: string) => void store.set(k, v),
        get: (k: string) => store.get(k) ?? null,
      };
    }
    static json(body: unknown, init?: { status?: number }) {
      const res = new (jest.requireMock("next/server").NextResponse)();
      res.status = init?.status || 200;
      res.body = body;
      return res;
    }
  },
}));

// Mock env so getAppConfig() can be controlled per test
const mockIsTestnet = { current: true };
jest.mock("@/lib/env", () => ({
  getAppConfig: () => ({ isTestnet: mockIsTestnet.current }),
}));

import {
  getClientIp,
  checkRateLimit,
  clearRateLimits,
  getLimitConfig,
} from "@/lib/server/rateLimiter";
import { MAINNET_RATE_LIMITS } from "@/lib/stellar/mainnet";

type MockRequest = {
  ip?: string;
  headers: { get: (name: string) => string | null };
};

function makeRequest(headers: Record<string, string>, ip?: string): MockRequest {
  return {
    ip,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  };
}

describe("getClientIp trust ordering", () => {
  it("prefers the platform-provided request.ip", () => {
    const req = makeRequest({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }, "9.9.9.9");
    expect(getClientIp(req as never)).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip before x-forwarded-for", () => {
    const req = makeRequest({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" });
    expect(getClientIp(req as never)).toBe("5.6.7.8");
  });

  it("uses the left-most entry of x-forwarded-for as last resort", () => {
    const req = makeRequest({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(getClientIp(req as never)).toBe("203.0.113.9");
  });

  it("trims whitespace from header values", () => {
    const req = makeRequest({ "x-real-ip": "  5.6.7.8  " });
    expect(getClientIp(req as never)).toBe("5.6.7.8");
  });

  it("returns unknown when no IP source is present", () => {
    const req = makeRequest({});
    expect(getClientIp(req as never)).toBe("unknown");
  });
});

describe("network-aware rate limits", () => {
  beforeEach(() => {
    clearRateLimits();
  });

  it("applies the stricter mainnet faucet limit (1 per day)", () => {
    mockIsTestnet.current = false;
    const req = makeRequest({ "x-real-ip": "10.0.0.1" });

    // First request allowed
    expect(checkRateLimit(req as never, "faucet", "GABC")).toBeNull();
    // Second request within the same window is blocked
    const blocked = checkRateLimit(req as never, "faucet", "GABC");
    expect(blocked).not.toBeNull();
    expect((blocked as { status: number }).status).toBe(429);
  });

  it("keeps testnet limits when isTestnet is true", () => {
    mockIsTestnet.current = true;
    const req = makeRequest({ "x-real-ip": "10.0.0.2" });

    expect(MAINNET_RATE_LIMITS.faucet.maxRequests).toBe(1);
    // Testnet allows one faucet request per address per minute
    expect(checkRateLimit(req as never, "faucet", "GXYZ")).toBeNull();
    const blocked = checkRateLimit(req as never, "faucet", "GXYZ");
    expect((blocked as { status: number }).status).toBe(429);
  });
});

describe("env-window overrides (testnet only)", () => {
  const KEYS = [
    "RATE_LIMIT_FAUCET_MS",
    "RATE_LIMIT_PAYMENT_MS",
    "RATE_LIMIT_CONTRACT_MS",
    "RATE_LIMIT_WALLET_MS",
    "RATE_LIMIT_GENERAL_MS",
  ];

  it("honors payment and wallet window overrides (in addition to the original three)", () => {
    process.env.RATE_LIMIT_PAYMENT_MS = "15000";
    process.env.RATE_LIMIT_WALLET_MS = "45000";
    process.env.RATE_LIMIT_FAUCET_MS = "2000";

    const config = getLimitConfig();
    expect(config.payment.windowMs).toBe(15000);
    expect(config.wallet.windowMs).toBe(45000);
    expect(config.faucet.windowMs).toBe(2000);
  });

  it("ignores malformed payment/wallet overrides without disabling limits", () => {
    process.env.RATE_LIMIT_PAYMENT_MS = "abc";
    process.env.RATE_LIMIT_WALLET_MS = "-1";

    const config = getLimitConfig();
    expect(config.payment.windowMs).toBe(60_000);
    expect(config.wallet.windowMs).toBe(60_000);
  });

  beforeEach(() => {
    mockIsTestnet.current = true;
    clearRateLimits();
  });

  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
    mockIsTestnet.current = true;
  });

  it("applies an explicit faucet window override", () => {
    process.env.RATE_LIMIT_FAUCET_MS = "120000"; // 1 per 2 minutes
    const req = makeRequest({ "x-real-ip": "10.0.0.3" });

    expect(checkRateLimit(req as never, "faucet", "GOVR1")).toBeNull();
    // Same address is still rate-limited within the overridden window.
    const blocked = checkRateLimit(req as never, "faucet", "GOVR1");
    expect((blocked as { status: number }).status).toBe(429);
  });

  it("ignores a malformed override instead of disabling the limit", () => {
    process.env.RATE_LIMIT_FAUCET_MS = "not-a-number";
    const req = makeRequest({ "x-real-ip": "10.0.0.4" });

    expect(checkRateLimit(req as never, "faucet", "GBAD1")).toBeNull();
    // A NaN window would never expire and never block — the limiter must fall
    // back to the default window so the address is still limited.
    const blocked = checkRateLimit(req as never, "faucet", "GBAD1");
    expect((blocked as { status: number }).status).toBe(429);
  });
});
