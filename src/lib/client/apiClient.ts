/**
 * API client — proxied writes through backend API routes.
 * For direct reads, use `@/lib/client/directClient` instead.
 *
 * State-changing routes enforce a double-submit CSRF check: the server sets a
 * `stellardripz_csrf` cookie and requires the same value in the `X-CSRF-Token`
 * header. This client reads the cookie on every request and echoes it as the
 * header so POST /faucet, /payment, /contract and /wallet routes are not
 * rejected with 403 "CSRF token missing".
 */

const BASE_URL = "";

/** Cookie name set by the server (src/lib/server/csrf.ts) and middleware. */
const CSRF_COOKIE = "stellardripz_csrf";
const CSRF_HEADER = "x-csrf-token";

/** Read the current CSRF token from document.cookie, if present. */
function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers);

  // All requests are JSON to our API routes.
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Echo the CSRF cookie as a header so state-changing routes pass validation.
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers.set(CSRF_HEADER, csrfToken);
  }

  const res = await fetch(url, { ...options, headers });

  // Some routes may return empty bodies (204) or non-JSON error pages; parse
  // defensively instead of throwing an unhelpful SyntaxError.
  const raw = await res.text();
  let json: unknown = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      /* non-JSON response body */
    }
  }

  if (!res.ok) {
    const retryAfter = res.headers.get("Retry-After");
    const message =
      (json as { error?: string } | null)?.error || `HTTP ${res.status}`;
    const error = new Error(message) as Error & { retryAfter?: number; status?: number };
    if (retryAfter) error.retryAfter = parseInt(retryAfter, 10);
    error.status = res.status;
    throw error;
  }

  return json as T;
}

// ---- Wallet ----

export function connectWallet(address: string, walletId: string, walletName: string) {
  return request<{ success: boolean; session: { address: string; walletId: string } }>(
    "/api/wallet/connect",
    { method: "POST", body: JSON.stringify({ address, walletId, walletName }) },
  );
}

// ---- Balance ----

export function fetchBalance(address: string) {
  return request<{
    xlm: string;
    raw: string;
    assets: Array<{ code: string; balance: string; formatted: string }>;
  }>(`/api/balance/${encodeURIComponent(address)}`);
}

// ---- Faucet ----

export function requestFaucet(address: string) {
  return request<{ success: boolean; hash: string; newBalance: string }>("/api/faucet/fund", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

// ---- Payments ----

export function buildPayment(
  senderAddress: string,
  destination: string,
  amount: string,
  assetCode?: string,
  assetIssuer?: string,
  memo?: string,
) {
  return request<{ xdr: string }>("/api/payment/send", {
    method: "POST",
    body: JSON.stringify({ senderAddress, destination, amount, assetCode, assetIssuer, memo }),
  });
}

export function submitPayment(
  signedXdr: string,
  senderAddress: string,
  destination: string,
  amount: string,
  assetCode?: string,
  assetIssuer?: string,
  memo?: string,
) {
  return request<{ success: boolean; hash: string }>("/api/payment/send", {
    method: "POST",
    body: JSON.stringify({ signedXdr, senderAddress, destination, amount, assetCode, assetIssuer, memo }),
  });
}

// ---- Contract ----

export function simulateContract(
  contractId: string,
  functionName: string,
  args: unknown[],
  signerAddress: string,
) {
  return request<{ resultValue?: string }>("/api/contract/invoke", {
    method: "POST",
    body: JSON.stringify({ contractId, functionName, args, signerAddress, simulate: true }),
  });
}

export function buildContractCall(
  contractId: string,
  functionName: string,
  args: unknown[],
  signerAddress: string,
) {
  return request<{ xdr: string }>("/api/contract/invoke", {
    method: "POST",
    body: JSON.stringify({ contractId, functionName, args, signerAddress }),
  });
}

export function submitContract(
  signedXdr: string,
  contractId: string,
  functionName: string,
  signerAddress: string,
) {
  return request<{ success: boolean; hash: string; resultValue?: string }>("/api/contract/invoke", {
    method: "POST",
    body: JSON.stringify({ signedXdr, contractId, functionName, signerAddress }),
  });
}

// ---- History ----

export function fetchHistory(address?: string, type?: string, limit?: number) {
  const params = new URLSearchParams();
  if (address) params.set("address", address);
  if (type) params.set("type", type);
  if (limit) params.set("limit", String(limit));
  return request<{
    transactions: Array<{
      id: string;
      type: string;
      status: string;
      hash: string | null;
      amount: string;
      assetCode?: string;
      senderAddress: string;
      destinationAddress: string;
      functionName?: string;
      contractId?: string;
      errorMessage?: string;
      timestamp: number;
    }>;
    total: number;
  }>(`/api/history?${params.toString()}`);
}

// ---- Analytics ----

export function fetchAnalytics(type?: string, summary?: boolean) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (summary) params.set("summary", "true");
  return request<{
    events?: Array<{
      eventType: string;
      address: string;
      timestamp: number;
      data?: Record<string, unknown>;
    }>;
    summary?: Record<string, { total: number; uniqueAddresses: number }>;
    total?: number;
  }>(`/api/analytics?${params.toString()}`);
}
