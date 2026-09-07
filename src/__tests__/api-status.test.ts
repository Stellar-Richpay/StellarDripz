/**
 * Tests for GET /api/status route.
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
  return { NextResponse: MockNextResponse };
});

const mockNetwork = {
  network: "testnet",
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
};
jest.mock("@/lib/stellar/network", () => ({
  STELLAR_NETWORK: mockNetwork,
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Stub the SDK surface the route touches. The Horizon/RPC stubs throw when
// constructed with an empty URL so the error path is testable.
jest.mock("@stellar/stellar-sdk", () => {
  class MockLedgerCall {
    async call() {
      return {};
    }
  }
  class MockHorizon {
    constructor(private url: string) {
      if (!this.url) throw new Error("horizon unreachable");
    }
    ledgers() {
      return { limit: () => new MockLedgerCall() };
    }
  }
  class MockRpc {
    constructor(private url: string) {
      if (!this.url) throw new Error("rpc unreachable");
    }
    async getLatestLedger() {
      return { sequence: 123 };
    }
  }
  return {
    Horizon: { Server: MockHorizon },
    rpc: { Server: MockRpc },
  };
});

describe("GET /api/status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({}),
    });
  });

  it("reports ok for all services when reachable", async () => {
    jest.resetModules();
    const mod = await import("@/app/api/status/route");
    const res = await mod.GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.network).toBe("testnet");
    expect(json.services.horizon.status).toBe("ok");
    expect(json.services.sorobanRpc.status).toBe("ok");
    expect(json.services.friendbot.status).toBe("ok");
    expect(typeof json.services.horizon.latency).toBe("number");
  });

  it("flags friendbot as ok on expected 4xx root responses", async () => {
    mockFetch.mockResolvedValue({
      status: 404,
      ok: false,
      json: () => Promise.resolve({}),
    });

    jest.resetModules();
    const mod = await import("@/app/api/status/route");
    const res = await mod.GET();

    const json = await res.json();
    // Friendbot's root returns 4xx for anonymous requests — that is
    // reachability, not an outage.
    expect(json.services.friendbot.status).toBe("ok");
    expect(json.services.friendbot.httpStatus).toBe(404);
  });

  it("reports friendbot error on genuine 5xx", async () => {
    mockFetch.mockResolvedValue({
      status: 500,
      ok: false,
      json: () => Promise.resolve({}),
    });

    jest.resetModules();
    const mod = await import("@/app/api/status/route");
    const res = await mod.GET();

    const json = await res.json();
    expect(json.services.friendbot.status).toBe("error");
  });

  it("reports horizon error when it throws", async () => {
    // Force the Horizon stub to fail by breaking the network config lookup.
    mockNetwork.horizonUrl = "";
    mockNetwork.sorobanRpcUrl = "";
    mockFetch.mockRejectedValue(new Error("unreachable"));

    jest.resetModules();
    const mod = await import("@/app/api/status/route");
    const res = await mod.GET();

    const json = await res.json();
    expect(json.services.horizon.status).toBe("error");
  });
});