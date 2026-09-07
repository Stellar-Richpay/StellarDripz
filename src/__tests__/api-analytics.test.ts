/**
 * Tests for GET /api/analytics route.
 */

jest.mock("next/server", () => {
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
  return {
    NextRequest: class {
      url: string;
      method = "GET";
      headers = { get: () => null };
      constructor(url: string) {
        this.url = url;
      }
      async json() {
        return {};
      }
    },
    NextResponse: MockNextResponse,
  };
});

const mockCheckRateLimit = jest.fn().mockReturnValue(null);
jest.mock("@/lib/server/rateLimiter", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockGetAnalytics = jest.fn().mockResolvedValue([]);
const mockGetAnalyticsSummary = jest.fn().mockResolvedValue({});
jest.mock("@/lib/server/dbService", () => ({
  getAnalytics: (...args: unknown[]) => mockGetAnalytics(...args),
  getAnalyticsSummary: (...args: unknown[]) => mockGetAnalyticsSummary(...args),
}));

describe("GET /api/analytics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_API_TOKEN; // open in dev/test
    mockCheckRateLimit.mockReturnValue(null);
    mockGetAnalytics.mockResolvedValue([]);
    mockGetAnalyticsSummary.mockResolvedValue({});
  });

  it("rejects an unknown event type with 400", async () => {
    jest.resetModules();
    const mod = await import("@/app/api/analytics/route");
    const req = new (require("next/server").NextRequest)(
      "http://localhost/api/analytics?type=not_a_real_type",
    );
    const res = await mod.GET(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid event type");
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  it("accepts a valid event type", async () => {
    jest.resetModules();
    const mod = await import("@/app/api/analytics/route");
    const req = new (require("next/server").NextRequest)(
      "http://localhost/api/analytics?type=payment_send",
    );
    const res = await mod.GET(req);

    expect(res.status).toBe(200);
    expect(mockGetAnalytics).toHaveBeenCalledWith("payment_send");
  });

  it("returns the summary when requested", async () => {
    jest.resetModules();
    const mod = await import("@/app/api/analytics/route");
    const req = new (require("next/server").NextRequest)(
      "http://localhost/api/analytics?summary=true",
    );
    const res = await mod.GET(req);

    expect(res.status).toBe(200);
    expect(mockGetAnalyticsSummary).toHaveBeenCalled();
  });
});