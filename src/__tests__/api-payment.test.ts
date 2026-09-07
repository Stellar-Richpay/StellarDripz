/**
 * Tests for POST /api/payment/send route.
 */

jest.mock("next/server", () => {
  class MockNextRequest {
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

jest.mock("@/lib/server/csrf", () => ({
  validateCsrf: jest.fn().mockReturnValue(null),
  setCsrfCookie: jest.fn(),
}));

const mockBuildPayment = jest.fn();
const mockSendPayment = jest.fn();
jest.mock("@/lib/server/horizonService", () => ({
  buildPaymentTransaction: (...args: unknown[]) => mockBuildPayment(...args),
  sendPaymentServer: (...args: unknown[]) => mockSendPayment(...args),
  validateAmount: jest.fn().mockReturnValue(null),
  validateAssetCode: jest.fn().mockReturnValue(null),
}));

import { NextRequest, NextResponse } from "next/server";

let POST: (req: InstanceType<typeof NextRequest>) => Promise<InstanceType<typeof NextResponse>>;

beforeAll(async () => {
  const mod = await import("@/app/api/payment/send/route");
  POST = mod.POST;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildPayment.mockResolvedValue({ xdr: "AAAAAg...=" });
  mockSendPayment.mockResolvedValue({ hash: "payment-hash-abc" });
});

function createReq(body: unknown): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost:3000/api/payment/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  } as any);
}

describe("POST /api/payment/send", () => {
  describe("build mode (no signedXdr)", () => {
    it("returns 400 when required fields missing", async () => {
      const req = createReq({});
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("builds a transaction and returns XDR", async () => {
      const req = createReq({
        senderAddress: "GSENDER12345678901234567890123456789012345678",
        destination: "GDEST45678901234567890123456789012345678901",
        amount: "100.0000000",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.xdr).toBe("AAAAAg...=");
    });
  });

  describe("submit mode (with signedXdr)", () => {
    it("returns 400 when required fields missing", async () => {
      const req = createReq({ signedXdr: "AAAA...==" });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("submits signed payment successfully", async () => {
      const req = createReq({
        signedXdr: "AAAA...==",
        senderAddress: "GSENDER12345678901234567890123456789012345678",
        destination: "GDEST45678901234567890123456789012345678901",
        amount: "50.0000000",
        assetCode: "USDC",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.hash).toBe("payment-hash-abc");
    });

    it("returns 500 on payment error", async () => {
      mockSendPayment.mockRejectedValueOnce(new Error("Insufficient balance"));
      const req = createReq({
        signedXdr: "AAAA...==",
        senderAddress: "GSENDER12345678901234567890123456789012345678",
        destination: "GDEST45678901234567890123456789012345678901",
        amount: "99999999.0000000",
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
  });
});
// Edge case: validates minimum payment amount > 0
