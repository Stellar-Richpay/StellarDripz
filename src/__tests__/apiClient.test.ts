/**
 * Tests for the API client's CSRF header injection and defensive JSON parsing.
 *
 * The server enforces a double-submit CSRF check on state-changing routes:
 * the `stellardripz_csrf` cookie value must be echoed in the `X-CSRF-Token`
 * header. These tests pin that behavior so a future refactor can't silently
 * break every POST flow again (see fix: client never sent the header).
 */
import { request, connectWallet, requestFaucet } from "@/lib/client/apiClient";

const CSRF_COOKIE = "stellardripz_csrf";
const CSRF_HEADER = "x-csrf-token";

/** Minimal Response-like object (jsdom env has no global Response). */
function mockResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: {
      get: (name: string) => init.headers?.[name] ?? null,
    },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function setCookie(value: string): void {
  Object.defineProperty(document, "cookie", {
    writable: true,
    value: `${CSRF_COOKIE}=${value}`,
    configurable: true,
  });
}

describe("apiClient CSRF integration", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    // Simulate the cookie the server/middleware sets on responses
    Object.defineProperty(document, "cookie", {
      writable: true,
      value: "",
      configurable: true,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("echoes the CSRF cookie value in the X-CSRF-Token header", async () => {
    setCookie("token-abc-123");
    fetchMock.mockResolvedValueOnce(mockResponse({ success: true }));

    await request("/api/faucet/fund", { method: "POST" });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get(CSRF_HEADER)).toBe("token-abc-123");
  });

  it("does not send the header when no CSRF cookie is present", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({}));

    await request("/api/balance/GABC", { method: "GET" });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get(CSRF_HEADER)).toBeNull();
  });

  it("parses the retry-after header into the thrown error", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ error: "Rate limited" }, { status: 429, headers: { "Retry-After": "42" } }),
    );

    await expect(requestFaucet("GABC")).rejects.toMatchObject({
      message: "Rate limited",
      retryAfter: 42,
      status: 429,
    });
  });

  it("handles non-JSON error responses without throwing a SyntaxError", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("<html>Bad Gateway</html>", { status: 502 }));

    await expect(connectWallet("GABC", "freighter", "Freighter")).rejects.toMatchObject({
      message: "HTTP 502",
    });
  });

  it("propagates the CSRF header through typed helpers", async () => {
    setCookie("token-xyz");
    fetchMock.mockResolvedValueOnce(
      mockResponse({ success: true, session: { address: "GABC", walletId: "freighter" } }),
    );

    await connectWallet("GABC", "freighter", "Freighter");

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;
    expect(headers.get(CSRF_HEADER)).toBe("token-xyz");
  });
});

describe("apiClient request timeout", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(document, "cookie", {
      writable: true,
      value: "",
      configurable: true,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  /** A fetch mock that stays pending until the caller aborts its signal. */
  function hangingFetch(): void {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(
              init.signal?.reason instanceof Error
                ? init.signal.reason
                : new DOMException("The operation was aborted", "AbortError"),
            ),
          );
        }),
    );
  }

  it("aborts requests that exceed the default timeout", async () => {
    jest.useFakeTimers();
    hangingFetch();

    const pending = request("/api/slow-endpoint", { method: "GET" });
    // Attach the rejection handler before the timer fires so the rejection
    // is never left unhandled while fake timers advance.
    const assertion = expect(pending).rejects.toThrow(/timed out after 25s/);
    await jest.advanceTimersByTimeAsync(25_000);
    await assertion;
  });

  it("honors a caller-provided abort signal instead of the timer", async () => {
    hangingFetch();
    const controller = new AbortController();

    const pending = request("/api/slow-endpoint", { method: "GET", signal: controller.signal });
    controller.abort(new Error("caller cancelled"));

    await expect(pending).rejects.toThrow(/caller cancelled/);
  });
});
