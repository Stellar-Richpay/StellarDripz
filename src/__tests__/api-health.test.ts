/**
 * Tests for GET /api/health route.
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
      url = "";
      method = "GET";
      headers = { get: () => null };
      async json() {
        return {};
      }
    },
    NextResponse: MockNextResponse,
  };
});

const mockGetConfig = jest.fn().mockReturnValue({
  nodeEnv: "test",
  isTestnet: true,
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  contractIdCounter: null,
  contractIdDripToken: null,
  contractIdDripPool: null,
  contractIdGovernance: null,
  contractIdBadge: null,
});

const mockValidateEnv = jest.fn().mockReturnValue({
  valid: true,
  errors: [],
  warnings: [],
});

jest.mock("@/lib/env", () => ({
  getAppConfig: (...args: unknown[]) => mockGetConfig(...args),
  validateEnv: (...args: unknown[]) => mockValidateEnv(...args),
}));

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("GET /api/health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if ((url as string).includes("horizon")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { status: "healthy" } }),
      });
    });
    mockGetConfig.mockReturnValue({
      nodeEnv: "test",
      isTestnet: true,
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
      contractIdCounter: null,
      contractIdDripToken: null,
      contractIdDripPool: null,
      contractIdGovernance: null,
      contractIdBadge: null,
    });
    mockValidateEnv.mockReturnValue({ valid: true, errors: [], warnings: [] });
  });

  it("returns healthy when all services are up", async () => {
    jest.resetModules();
    const mod = await import("@/app/api/health/route");
    const res = await mod.GET();

    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe("healthy");
    expect(typeof json.uptime).toBe("number");
    expect(json.environment).toBe("test");
    expect(json.network).toBe("testnet");
    expect(json.services).toBeDefined();
    expect(json.contracts).toBeDefined();
  });

  it("includes contract status information", async () => {
    jest.resetModules();
    const mod = await import("@/app/api/health/route");
    const res = await mod.GET();

    const json = (await res.json()) as Record<string, unknown>;
    const contracts = json.contracts as Record<string, unknown>;
    expect(contracts.counter).toBe("not set");
    expect(contracts.dripToken).toBe("not set");
    expect(contracts.dripPool).toBe("not set");
    expect(contracts.governance).toBe("not set");
    expect(contracts.badge).toBe("not set");
  });

  it("returns degraded when services are down", async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error("Connection refused")));

    jest.resetModules();
    const mod = await import("@/app/api/health/route");
    const res = await mod.GET();

    expect(res.status).toBe(503);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe("degraded");
  });

  it("includes warnings from env validation", async () => {
    mockValidateEnv.mockReturnValue({
      valid: true,
      errors: [],
      warnings: ["No contract IDs configured"],
    });

    jest.resetModules();
    const mod = await import("@/app/api/health/route");
    const res = await mod.GET();

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.warnings as string[]).toContain("No contract IDs configured");
  });

  it("dedupes concurrent probes into one round of external calls", async () => {
    // Use a deferred so both GETs are truly in flight at the same time.
    let resolveFetch: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const gate = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((r) => {
      resolveFetch = r;
    });
    mockFetch.mockImplementation(() => gate);

    jest.resetModules();
    const mod = await import("@/app/api/health/route");

    // Kick off two concurrent health checks against a cold cache.
    const first = mod.GET();
    const second = mod.GET();

    // The second check must not have issued its own probes: only the first
    // check's Horizon probe is in flight so far.
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Both probes consume the same deferred response; the RPC branch reads
    // result.status while the Horizon branch only checks ok.
    resolveFetch!({
      ok: true,
      json: () => Promise.resolve({ result: { status: "healthy" } }),
    });
    const [res1, res2] = await Promise.all([first, second]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Exactly one probe round for both requests (cache is now warm).
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// Make this file a module so top-level declarations don't leak into the
// global scope shared with other test files during typechecking.
export {};
