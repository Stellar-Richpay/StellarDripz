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

const mockGetTransactions = jest.fn();
jest.mock("@/lib/server/dbService", () => ({
  getTransactions: (...args: unknown[]) => mockGetTransactions(...args),
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
    const req = new NextRequest(
      "http://localhost:3000/api/history?address=GADDR123&type=faucet&limit=10",
    ) as InstanceType<typeof NextRequest>;
    await GET(req);
    expect(mockGetTransactions).toHaveBeenCalledWith("GADDR123", "faucet", 10, 0);
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
    const req = new NextRequest("http://localhost:3000/api/history") as InstanceType<
      typeof NextRequest
    >;
    const res = await GET(req);

    const json = await res.json();
    expect(json.transactions).toEqual([]);
    expect(json.total).toBe(0);
  });
});
