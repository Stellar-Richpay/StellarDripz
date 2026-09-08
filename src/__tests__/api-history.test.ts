/**
 * Tests for GET /api/history route.
 */

jest.mock("next/server", () => {
  class MockNextRequest {
    url: string;
    method: string;
    headers = { get: () => null };
    constructor(input: string, init?: RequestInit) {
      this.url = input;
      this.method = init?.method || "GET";
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
}));

const mockGetTransactions = jest.fn();
const mockGetTransactionsCount = jest.fn();
jest.mock("@/lib/server/dbService", () => ({
  getTransactions: (...args: unknown[]) => mockGetTransactions(...args),
  getTransactionsCount: (...args: unknown[]) => mockGetTransactionsCount(...args),
  clearDb: jest.fn(),
}));

import { NextRequest, NextResponse } from "next/server";

let GET: (req: InstanceType<typeof NextRequest>) => Promise<InstanceType<typeof NextResponse>>;

beforeAll(async () => {
  const mod = await import("@/app/api/history/route");
  GET = mod.GET;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTransactions.mockReturnValue([
    {
      id: "tx-1",
      type: "faucet",
      status: "success",
      hash: "hash1",
      amount: "10000",
      senderAddress: "friendbot",
      destinationAddress: "GDEST123",
      timestamp: 1700000000000,
    },
  ]);
  mockGetTransactionsCount.mockReturnValue(1);
});

describe("GET /api/history", () => {
  it("returns transactions from the database", async () => {
    const req = new NextRequest("http://localhost:3000/api/history") as InstanceType<
      typeof NextRequest
    >;
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.transactions.length).toBe(1);
    expect(json.transactions[0].id).toBe("tx-1");
  });

  it("passes query parameters to the database", async () => {
    const valid = "GCNIK6CGM3DXD3NJPZBG4Z76NGCU6YNID3TK7OSTKOJXF3ALBVJWESXK";
    const req = new NextRequest(
      `http://localhost:3000/api/history?address=${valid}&type=faucet&limit=10`,
    ) as InstanceType<typeof NextRequest>;
    await GET(req);
    expect(mockGetTransactions).toHaveBeenCalledWith(valid, "faucet", 10, 0);
  });

  it("clamps limit to 100", async () => {
    const req = new NextRequest("http://localhost:3000/api/history?limit=500") as InstanceType<
      typeof NextRequest
    >;
    await GET(req);
    expect(mockGetTransactions).toHaveBeenCalledWith(undefined, undefined, 100, 0);
  });

  it("returns empty array when no transactions", async () => {
    mockGetTransactions.mockReturnValueOnce([]);
    mockGetTransactionsCount.mockReturnValueOnce(0);
    const req = new NextRequest("http://localhost:3000/api/history") as InstanceType<
      typeof NextRequest
    >;
    const res = await GET(req);

    const json = await res.json();
    expect(json.transactions).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.hasMore).toBe(false);
  });

  it("reports the true filtered total and hasMore for paging", async () => {
    mockGetTransactionsCount.mockReturnValueOnce(137);
    const req = new NextRequest(
      "http://localhost:3000/api/history?limit=50&offset=0",
    ) as InstanceType<typeof NextRequest>;
    const res = await GET(req);

    const json = await res.json();
    expect(json.transactions.length).toBe(1);
    expect(json.total).toBe(137);
    expect(json.hasMore).toBe(true);
  });

  it("falls back to the default limit on a non-numeric limit", async () => {
    const req = new NextRequest("http://localhost:3000/api/history?limit=abc") as InstanceType<
      typeof NextRequest
    >;
    await GET(req);
    expect(mockGetTransactions).toHaveBeenCalledWith(undefined, undefined, 50, 0);
  });

  it("falls back to zero offset on a negative offset", async () => {
    const req = new NextRequest("http://localhost:3000/api/history?offset=-50") as InstanceType<
      typeof NextRequest
    >;
    await GET(req);
    expect(mockGetTransactions).toHaveBeenCalledWith(undefined, undefined, 50, 0);
  });

  it("rejects a malformed address filter with 400", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/history?address=not-an-address",
    ) as InstanceType<typeof NextRequest>;
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });

  it("accepts a checksum-valid address filter", async () => {
    const valid = "GCNIK6CGM3DXD3NJPZBG4Z76NGCU6YNID3TK7OSTKOJXF3ALBVJWESXK";
    const req = new NextRequest(
      `http://localhost:3000/api/history?address=${valid}`,
    ) as InstanceType<typeof NextRequest>;
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockGetTransactions).toHaveBeenCalledWith(valid, undefined, 50, 0);
  });

  it("rejects an unknown type filter with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/history?type=not_real") as InstanceType<
      typeof NextRequest
    >;
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });
});

export {};
