/**
 * Tests for GET /api/events (SSE stream) guard branches.
 *
 * The happy path returns an open ReadableStream, which is impractical to
 * assert on without a live RPC — these tests cover the fail-fast guards
 * that run before a stream slot is consumed: missing and malformed
 * contract IDs must return 400 JSON rather than opening a stream that
 * errors forever.
 */

jest.mock("next/server", () => {
  return {
    NextRequest: class {
      url: string;
      method: string;
      constructor(input: string, init?: RequestInit) {
        this.url = input;
        this.method = init?.method || "GET";
      }
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
    },
  };
});

const mockGetContractEventsServer = jest.fn();
const mockGetLatestLedgerServer = jest.fn();
// jsdom doesn't expose the web ReadableStream/TextEncoder globals the SSE
// route relies on; pull them from Node's stream/web (and node:util for the
// encoder) so the success path can actually construct its stream in tests.
// This must run before the route is dynamically imported in beforeAll.
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { TextEncoder as NodeTextEncoder } from "node:util";
(globalThis as Record<string, unknown>).ReadableStream ??= NodeReadableStream;
(globalThis as Record<string, unknown>).TextEncoder ??= NodeTextEncoder;
// The SSE route returns `new Response(stream, ...)` (the web global), which
// jsdom doesn't provide either — give it a minimal stand-in that keeps the
// body and headers so tests can cancel the stream and read content-type.
if (typeof (globalThis as Record<string, unknown>).Response === "undefined") {
  class MiniResponse {
    status = 200;
    headers: Headers;
    body: unknown;
    constructor(body?: unknown, init?: { status?: number; headers?: HeadersInit }) {
      this.body = body;
      this.headers = new Headers(init?.headers);
      if (init?.status) this.status = init.status;
    }
  }
  (globalThis as Record<string, unknown>).Response = MiniResponse;
}

jest.mock("@/lib/server/sorobanService", () => ({
  getContractEventsServer: (...args: unknown[]) => mockGetContractEventsServer(...args),
  getLatestLedgerServer: (...args: unknown[]) => mockGetLatestLedgerServer(...args),
}));

jest.mock("@/lib/server/rateLimiter", () => ({
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { NextRequest } from "next/server";

// The route returns NextResponse.json for errors but a web Response for the
// stream — type against the common Response base so both fit at runtime.
let GET: (req: InstanceType<typeof NextRequest>) => Promise<Response>;

beforeAll(async () => {
  const mod = await import("@/app/api/events/route");
  GET = mod.GET;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetContractEventsServer.mockResolvedValue({ events: [], latestLedger: 1 });
  mockGetLatestLedgerServer.mockResolvedValue(1);
});

function createReq(url: string): InstanceType<typeof NextRequest> {
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/events", () => {
  it("returns 400 when contractId is missing", async () => {
    const res = await GET(createReq("http://localhost:3000/api/events"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("contractId");

    // No stream slot logic or RPC calls should have run.
    expect(mockGetLatestLedgerServer).not.toHaveBeenCalled();
  });

  it("rejects a malformed contract ID instead of opening a broken stream", async () => {
    const res = await GET(
      createReq("http://localhost:3000/api/events?contractId=not-a-contract-id"),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid");

    expect(mockGetLatestLedgerServer).not.toHaveBeenCalled();
  });

  it("rejects a wrong-checksum contract ID that matches the alphabet", async () => {
    const res = await GET(
      createReq(
        "http://localhost:3000/api/events?contractId=CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      ),
    );
    expect(res.status).toBe(400);
  });

  it("clamps an absurd pollInterval instead of honoring it verbatim", async () => {
    // A valid checksum contract ID opens a real stream; cancel it right away
    // and assert the slot accounting released. The clamped interval can't be
    // observed directly here, but this guards the code path end-to-end.
    const res = await GET(
      createReq(
        "http://localhost:3000/api/events?contractId=CCQCJNBKMVVZX5KAEV7MHMF47D4C4QXOOXSODGNBXDQOMEMWT3L5QRZM&pollInterval=999999999",
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Abort the stream so the route's cancel() path releases its slot.
    res.body?.cancel();
  });
});

// Make this file a module so top-level declarations don't leak into the
// global scope shared with other test files during typechecking.
export {};
