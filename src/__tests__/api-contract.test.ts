/**
 * Tests for POST /api/contract/invoke route.
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
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

jest.mock("@/lib/server/csrf", () => ({
  validateCsrf: jest.fn().mockReturnValue(null),
  setCsrfCookie: jest.fn(),
}));

const mockSimulate = jest.fn();
const mockBuild = jest.fn();
const mockSubmit = jest.fn();
jest.mock("@/lib/server/sorobanService", () => ({
  simulateContractCallServer: (...args: unknown[]) => mockSimulate(...args),
  buildContractInvocation: (...args: unknown[]) => mockBuild(...args),
  submitContractInvocation: (...args: unknown[]) => mockSubmit(...args),
}));

import { NextRequest, NextResponse } from "next/server";

let POST: (req: InstanceType<typeof NextRequest>) => Promise<InstanceType<typeof NextResponse>>;

beforeAll(async () => {
  const mod = await import("@/app/api/contract/invoke/route");
  POST = mod.POST;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSimulate.mockResolvedValue({ resultValue: "42" });
  mockBuild.mockResolvedValue({ xdr: "AAAA...==" });
  mockSubmit.mockResolvedValue({ hash: "contract-hash-abc", resultValue: "42" });
});

function createReq(body: unknown): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost:3000/api/contract/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  } as any);
}

describe("POST /api/contract/invoke", () => {
  describe("validation", () => {
    it("returns 400 when required fields missing", async () => {
      const req = createReq({});
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("simulate mode", () => {
    it("simulates a contract call and returns result", async () => {
      const req = createReq({
        contractId: "CCQCJNBKMVVZX5KAEV7MHMF47D4C4QXOOXSODGNBXDQOMEMWT3L5QRZM",
        functionName: "get_counter",
        signerAddress: "GSIGNER12345678901234567890123456789012345678",
        simulate: true,
        args: [],
      });
      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.resultValue).toBe("42");

      // Simulate drives an RPC call, so it must consume the per-IP general
      // bucket rather than being unrate-limited.
      const { checkRateLimit } = jest.requireMock("@/lib/server/rateLimiter");
      expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), "general");
    });
  });

  describe("build mode", () => {
    it("builds a contract invocation and returns XDR", async () => {
      const req = createReq({
        contractId: "CCQCJNBKMVVZX5KAEV7MHMF47D4C4QXOOXSODGNBXDQOMEMWT3L5QRZM",
        functionName: "increment",
        signerAddress: "GSIGNER12345678901234567890123456789012345678",
        args: ["test_arg"],
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect((await res.json()).xdr).toBe("AAAA...==");

      // Building also runs an RPC simulation for the footprint — same cap.
      const { checkRateLimit } = jest.requireMock("@/lib/server/rateLimiter");
      expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), "general");
    });
  });

  describe("submit mode", () => {
    it("submits signed contract invocation", async () => {
      const req = createReq({
        contractId: "CCQCJNBKMVVZX5KAEV7MHMF47D4C4QXOOXSODGNBXDQOMEMWT3L5QRZM",
        functionName: "increment",
        signerAddress: "GSIGNER12345678901234567890123456789012345678",
        signedXdr: "AAAA...==",
        args: [],
      });
      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.hash).toBe("contract-hash-abc");

      // Submissions keep the tighter per-address contract bucket.
      const { checkRateLimit } = jest.requireMock("@/lib/server/rateLimiter");
      expect(checkRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        "contract",
        "GSIGNER12345678901234567890123456789012345678",
      );
    });

    it("returns 400 when an argument value is not an integer", async () => {
      const req = createReq({
        contractId: "CCQCJNBKMVVZX5KAEV7MHMF47D4C4QXOOXSODGNBXDQOMEMWT3L5QRZM",
        functionName: "increment",
        signerAddress: "GSIGNER12345678901234567890123456789012345678",
        args: [1.5],
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/unsupported numeric argument/i);
    });

    it("returns 400 when an argument has an unsupported shape", async () => {
      const req = createReq({
        contractId: "CCQCJNBKMVVZX5KAEV7MHMF47D4C4QXOOXSODGNBXDQOMEMWT3L5QRZM",
        functionName: "increment",
        signerAddress: "GSIGNER12345678901234567890123456789012345678",
        args: [{ unexpected: "shape" }],
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/unsupported argument type/i);
    });

    it("returns 500 on contract error", async () => {
      mockSubmit.mockRejectedValueOnce(new Error("Contract call reverted"));
      const req = createReq({
        contractId: "CCQCJNBKMVVZX5KAEV7MHMF47D4C4QXOOXSODGNBXDQOMEMWT3L5QRZM",
        functionName: "bad_function",
        signerAddress: "GSIGNER12345678901234567890123456789012345678",
        signedXdr: "AAAA...==",
        args: [],
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
  });
});
// Edge case: validates malformed contract IDs
