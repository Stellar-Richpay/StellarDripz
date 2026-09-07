/**
 * Tests for the shared API HTTP helpers (src/lib/server/http.ts):
 * parseJsonBody's content-type/size/shape guards and toHttpError's
 * production-vs-development error surfacing.
 */

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("@/lib/server/rateLimiter", () => ({
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

// parseJsonBody takes a NextRequest-like object; a plain stub with the two
// members it touches is enough and keeps this free of next/server internals.
interface FakeRequest {
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}

function makeRequest(body: string, contentType = "application/json"): FakeRequest {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null),
    },
    text: () => Promise.resolve(body),
  };
}

import { parseJsonBody, toHttpError, HttpError, isHttpError } from "@/lib/server/http";

describe("parseJsonBody", () => {
  it("rejects a missing/incorrect content type with 415", async () => {
    const req = makeRequest("{}", "text/plain");
    await expect(parseJsonBody(req as never)).rejects.toMatchObject({ status: 415 });
  });

  it("rejects oversized bodies with 413", async () => {
    const req = makeRequest(`{"data":"${"x".repeat(100)}"}`, "application/json");
    // Pass a tiny cap so the fixture exceeds it.
    await expect(parseJsonBody(req as never, 50)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects malformed JSON with 400", async () => {
    const req = makeRequest("{not json");
    await expect(parseJsonBody(req as never)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a JSON array body (must be an object)", async () => {
    const req = makeRequest("[1,2,3]");
    await expect(parseJsonBody(req as never)).rejects.toMatchObject({ status: 400 });
  });

  it("parses a valid JSON object body", async () => {
    const req = makeRequest('{"address":"GABC"}');
    await expect(parseJsonBody(req as never)).resolves.toEqual({ address: "GABC" });
  });
});

describe("toHttpError", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  /** NODE_ENV is declared read-only on process.env; flip it via defineProperty. */
  function setNodeEnv(value: string): void {
    Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true });
  }

  afterEach(() => {
    setNodeEnv(originalNodeEnv || "test");
  });

  it("passes HttpError through unchanged", () => {
    const httpErr = new HttpError(400, "Bad request");
    const result = toHttpError(httpErr);
    expect(result).toBe(httpErr);
    expect(result.status).toBe(400);
  });

  it("keeps detailed messages outside production", () => {
    setNodeEnv("development");
    const result = toHttpError(new Error("Simulation failed: boom"));
    expect(result.status).toBe(500);
    expect(result.message).toBe("Simulation failed: boom");
  });

  it("returns a generic message in production without leaking internals", () => {
    setNodeEnv("production");
    const result = toHttpError(new Error("RPC response: {secrets}"));
    expect(result.status).toBe(500);
    expect(result.message).toBe("Internal server error");
    expect(result.message).not.toContain("secrets");
  });

  it("isHttpError narrows HttpError instances", () => {
    expect(isHttpError(new HttpError(429, "too many"))).toBe(true);
    expect(isHttpError(new Error("plain"))).toBe(false);
  });
});
