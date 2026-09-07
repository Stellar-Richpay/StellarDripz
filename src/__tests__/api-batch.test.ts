/**
 * Tests for POST /api/batch route.
 */
import type { NextRequest } from "next/server";

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
    cookies = { set: jest.fn() };
  },
  NextResponse: class {
    status: number;
    private body: unknown;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status || 200;
      this.body = body;
    }
    static json(body: unknown, init?: ResponseInit) {
      return new (jest.requireMock("next/server").NextResponse)(body, init);
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
    cookies = { set: jest.fn() };
  },
}));

jest.mock("@/lib/stellar/network", () => ({
  STELLAR_NETWORK: { friendbotUrl: "https://friendbot.stellar.org" },
}));

const mockValidateCsrf = jest.fn().mockReturnValue(null);
jest.mock("@/lib/server/csrf", () => ({
  validateCsrf: (...args: unknown[]) => mockValidateCsrf(...args),
  setCsrfCookie: jest.fn(),
}));

const mockCheckRateLimit = jest.fn().mockReturnValue(null);
jest.mock("@/lib/server/rateLimiter", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

jest.mock("@/lib/server/horizonService", () => ({
  assertFaucetAllowed: jest.fn(),
}));

const mockIsValid = jest.fn();
jest.mock("@/lib/stellar/address", () => ({
  isValidStellarAddress: (...args: unknown[]) => mockIsValid(...args),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const VALID_ADDR = "GDWBEWOFHQGSNFJOK6Q3BG2SEZQKWQ3WVQPAGI7C2BNVZXG4LBBHIZPO";
const VALID_ADDR_2 = "GDKITNYZI5THB72MMUUEQS26VIKTO32DY2OV4KXNUWT26FIJ45ABU2VB";

describe("POST /api/batch", () => {
  // The route's real POST signature; the mock NextRequest is structurally
  // compatible because the route only reads url/method/headers/body.
  let POST: (req: InstanceType<typeof NextRequest>) => Promise<{
    status: number;
    json: () => Promise<unknown>;
  }>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCsrf.mockReturnValue(null);
    mockCheckRateLimit.mockReturnValue(null);
    mockIsValid.mockReturnValue(true);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hash: "txhash-1" }),
    });
  });

  beforeAll(async () => {
    const mod = await import("@/app/api/batch/route");
    POST = mod.POST;
  });

  it("funds each distinct valid address", async () => {
    const req = new (jest.requireMock("next/server").NextRequest)(
      "http://localhost/api/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: [VALID_ADDR, VALID_ADDR_2] }),
      },
    );
    const res = await POST(req);
    const json = (await res.json()) as { total: number; succeeded: number };
    expect(json.total).toBe(2);
    expect(json.succeeded).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("dedupes repeated addresses before funding", async () => {
    const req = new (jest.requireMock("next/server").NextRequest)(
      "http://localhost/api/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: [VALID_ADDR, VALID_ADDR] }),
      },
    );
    const res = await POST(req);
    const json = (await res.json()) as { total: number };
    // One address funded once, not twice (which would 429 the second call).
    expect(json.total).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects more than the max batch size", async () => {
    const many = Array.from({ length: 11 }, () => VALID_ADDR);
    const req = new (jest.requireMock("next/server").NextRequest)(
      "http://localhost/api/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: many }),
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects an empty address list", async () => {
    const req = new (jest.requireMock("next/server").NextRequest)(
      "http://localhost/api/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: [] }),
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects an invalid address before calling Friendbot", async () => {
    mockIsValid.mockReturnValue(false);
    const req = new (jest.requireMock("next/server").NextRequest)(
      "http://localhost/api/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: ["GNOTVALID"] }),
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns per-address errors when Friendbot fails", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    );
    const req = new (jest.requireMock("next/server").NextRequest)(
      "http://localhost/api/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: [VALID_ADDR] }),
      },
    );
    const res = await POST(req);
    const json = (await res.json()) as { failed: number; results: Array<{ status: string }> };
    expect(json.failed).toBe(1);
    expect(json.results[0].status).toBe("error");
  });
});

export {};