/**
 * Tests for GET /api/balance/[address] route.
 */

jest.mock("next/server", () => {
  class MockNextRequest {
    url: string;
    method: string;
    headers: { get: (name: string) => string | null };
    constructor(input: string, init?: RequestInit) {
      this.url = input;
      this.method = init?.method || "GET";
      this.headers = { get: () => null };
    }
    async json() {
      return {};
    }
  }
  class MockNextResponse {
    status: number;
    private body: unknown;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status || 200;
      this.body = body;
    }
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init);
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
  }
  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse };
});

jest.mock("@/lib/server/rateLimiter", () => ({
  checkRateLimit: jest.fn().mockReturnValue(null),
  attachRateLimitHeaders: jest.fn((_req: unknown, res: unknown) => res),
  clearRateLimits: jest.fn(),
}));

const mockFetchBalanceServer = jest.fn();
jest.mock("@/lib/server/horizonService", () => ({
  fetchBalanceServer: (...args: unknown[]) => mockFetchBalanceServer(...args),
}));

import { NextRequest, NextResponse } from "next/server";

let GET: (
  req: InstanceType<typeof NextRequest>,
  ctx: { params: Promise<{ address: string }> },
) => Promise<InstanceType<typeof NextResponse>>;

// A checksum-valid Ed25519 public key (StrKey) — the old null address
// "GAAAA..." fails checksum validation and is correctly rejected.
const VALID_ADDR = "GC2MCTJBOATQKMURSX443SX25PGV34SK7U56UJ3Y7HHXQ2JK57OR23SX";

beforeAll(async () => {
  const mod = await import("@/app/api/balance/[address]/route");
  GET = mod.GET;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchBalanceServer.mockResolvedValue({
    xlm: "500.0000000",
    raw: "5000000000",
    assets: [],
  });
});

describe("GET /api/balance/[address]", () => {
  it("returns 400 for invalid address", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/balance/bad-address",
    ) as unknown as InstanceType<typeof NextRequest>;
    const res = await GET(req, { params: Promise.resolve({ address: "bad-address" }) });
    expect(res.status).toBe(400);
  });

  it("fetches balance for valid address", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/balance/${VALID_ADDR}`,
    ) as unknown as InstanceType<typeof NextRequest>;
    const res = await GET(req, { params: Promise.resolve({ address: VALID_ADDR }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.xlm).toBe("500.0000000");
    expect(mockFetchBalanceServer).toHaveBeenCalledWith(VALID_ADDR);
  });

  it("returns 500 on fetch error", async () => {
    mockFetchBalanceServer.mockRejectedValueOnce(new Error("Horizon timeout"));
    const req = new NextRequest(
      `http://localhost:3000/api/balance/${VALID_ADDR}`,
    ) as unknown as InstanceType<typeof NextRequest>;
    const res = await GET(req, { params: Promise.resolve({ address: VALID_ADDR }) });
    expect(res.status).toBe(500);
  });
});
// Edge case: handles uninitialized accounts (404 from Horizon)
