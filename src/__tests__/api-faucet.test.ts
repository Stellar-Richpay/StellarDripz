/**
 * Test isolation: each test suite uses jest.mock for external dependencies.
 * API route tests mock next/server to avoid "Request is not defined" in jsdom.
 * All mocks are cleared between tests via beforeEach jest.clearAllMocks().
 */
/**
 * Tests for POST /api/faucet/fund route.
 */

// Mock next/server FIRST (hoisted by jest)
jest.mock("next/server", () => ({
  NextRequest: class {
    url: string;
    method: string;
    headers: { get: (name: string) => string | null };
    private bodyStr: string;
    constructor(input: string, init?: RequestInit) {
      this.url = input;
      this.method = init?.method || "GET";
      this.headers = {
        get: (name: string) =>
          (init?.headers as Record<string, string> | undefined)?.[name.toLowerCase()] ?? null,
      };
      this.bodyStr = (init as { body?: string } | undefined)?.body || "";
    }
    async json() {
      try {
        return JSON.parse(this.bodyStr);
      } catch {
        return {};
      }
    }
    async text() {
      return this.bodyStr;
    }
  },
  NextResponse: class {
    status: number;
    private body: unknown;
    private headersObj: Headers;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status || 200;
      this.body = body;
      this.headersObj = new Headers(init?.headers as HeadersInit);
    }
    static json(body: unknown, init?: ResponseInit) {
      return new (jest.requireMock("next/server").NextResponse)(body, init);
    }
    get headers() {
      return this.headersObj;
    }
    async json() {
      if (typeof this.body === "string") {
        try {
          return JSON.parse(this.body);
        } catch {
          return this.body;
        }
      }
      return this.body;
    }
  },
}));

jest.mock("@/lib/server/rateLimiter", () => ({
  checkRateLimit: jest.fn().mockReturnValue(null),
  attachRateLimitHeaders: jest.fn((_req: unknown, res: unknown) => res),
  clearRateLimits: jest.fn(),
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

const mockRequestFaucetFundsServer = jest.fn();
jest.mock("@/lib/server/horizonService", () => ({
  requestFaucetFundsServer: (...args: unknown[]) => mockRequestFaucetFundsServer(...args),
}));

// Mock CSRF to always pass in tests
jest.mock("@/lib/server/csrf", () => ({
  validateCsrf: jest.fn().mockReturnValue(null),
  setCsrfCookie: jest.fn(),
  generateCsrfToken: jest.fn().mockReturnValue("test-csrf-token"),
}));

import { NextRequest, NextResponse } from "next/server";

let POST: (req: InstanceType<typeof NextRequest>) => Promise<InstanceType<typeof NextResponse>>;

beforeAll(async () => {
  const mod = await import("@/app/api/faucet/fund/route");
  POST = mod.POST;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestFaucetFundsServer.mockResolvedValue({
    hash: "tx-hash-123",
    newBalance: "10000.0000000",
  });
});

function createReq(method: string, body: unknown): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost:3000/api/faucet/fund", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  } as any);
}

describe("POST /api/faucet/fund", () => {
  it("returns 400 when address is missing", async () => {
    const req = createReq("POST", {});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("required");
  });

  it("returns 400 for invalid address format", async () => {
    const req = createReq("POST", { address: "not-a-stellar-address" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("funds a valid address successfully", async () => {
    const req = createReq("POST", {
      address: "GC2MCTJBOATQKMURSX443SX25PGV34SK7U56UJ3Y7HHXQ2JK57OR23SX",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.hash).toBe("tx-hash-123");
  });

  it("returns 500 on faucet failure", async () => {
    mockRequestFaucetFundsServer.mockRejectedValueOnce(new Error("Friendbot down"));
    const req = createReq("POST", {
      address: "GC2MCTJBOATQKMURSX443SX25PGV34SK7U56UJ3Y7HHXQ2JK57OR23SX",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("rejects a wrong-checksum address that matches the character set", async () => {
    // 56 G-address chars but an invalid StrKey checksum — passes a regex,
    // must fail checksum validation.
    const req = createReq("POST", {
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid");
  });
});
// Edge case: handles empty address string gracefully
