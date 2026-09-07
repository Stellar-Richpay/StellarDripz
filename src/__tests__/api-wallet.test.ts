/**
 * Tests for POST /api/wallet/connect route.
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


jest.mock("@/lib/server/csrf", () => ({
  validateCsrf: jest.fn().mockReturnValue(null),
  setCsrfCookie: jest.fn(),
}));

jest.mock("@/lib/server/rateLimiter", () => ({
  checkRateLimit: jest.fn().mockReturnValue(null),
  clearRateLimits: jest.fn(),
}));

const mockCreateSession = jest.fn();
jest.mock("@/lib/server/sessionManager", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  validateSession: jest.fn(),
}));

import { NextRequest, NextResponse } from "next/server";

let POST: (req: InstanceType<typeof NextRequest>) => Promise<InstanceType<typeof NextResponse>>;

beforeAll(async () => {
  const mod = await import("@/app/api/wallet/connect/route");
  POST = mod.POST;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateSession.mockReturnValue({
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    walletId: "freighter",
    walletName: "Freighter",
    connectedAt: 1700000000000,
    lastActive: 1700000000000,
  });
});

function createReq(body: unknown): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost:3000/api/wallet/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  } as any);
}

describe("POST /api/wallet/connect", () => {
  it("returns 400 when address or walletId missing", async () => {
    const req = createReq({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid address format", async () => {
    const req = createReq({ address: "bad-address", walletId: "freighter" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates a session successfully", async () => {
    const req = createReq({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      walletId: "freighter",
      walletName: "Freighter",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.session.address).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("handles session creation error", async () => {
    mockCreateSession.mockImplementationOnce(() => {
      throw new Error("Session limit reached");
    });
    const req = createReq({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      walletId: "freighter",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
