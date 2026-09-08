/**
 * Shared HTTP helpers for API routes.
 *
 * - parseJsonBody: strict, size-capped JSON parsing. Rejects wrong
 *   Content-Type, oversized bodies, and malformed JSON up front instead of
 *   letting each route parse blindly.
 * - HttpError: typed error carrying an HTTP status, so route catch blocks
 *   can return the right code instead of blanket 500s.
 */
import { NextRequest } from "next/server";
import { getClientIp } from "@/lib/server/rateLimiter";
import { logger } from "@/lib/logger";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** True when an unknown thrown value is an HttpError. */
export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

const DEFAULT_MAX_BYTES = 64 * 1024; // 64 KB — plenty for our payloads

/**
 * Read and validate a JSON request body.
 * Throws HttpError (415/413/400) on invalid input.
 */
export async function parseJsonBody(
  request: NextRequest,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  const text = await request.text();
  // text.length counts UTF-16 code units, but maxBytes is a *byte* budget:
  // a payload full of multi-byte characters (emoji, non-Latin scripts) could
  // exceed the byte cap while still passing a code-unit count. Measure the
  // UTF-8 encoding, which is what the HTTP layer and our JSON consumers see.
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new HttpError(413, `Request body too large (max ${maxBytes} bytes)`);
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

/**
 * Convert any error into an HttpError. Client errors (4xx HttpError) pass
 * through unchanged. Unknown errors become 500s whose message is logged
 * server-side but only surfaced to the client in non-production environments
 * — production callers get a generic message instead of raw SDK error text,
 * which can embed XDRs, Horizon/RPC response bodies, or internals.
 */
export function toHttpError(err: unknown): HttpError {
  if (isHttpError(err)) return err;

  const message = err instanceof Error ? err.message : "Internal server error";
  logger.error("Unhandled route error", err instanceof Error ? err : new Error(String(err)));

  if (process.env.NODE_ENV !== "production") {
    return new HttpError(500, message);
  }
  return new HttpError(500, "Internal server error");
}

/**
 * Resolve request metadata for analytics logging, using the same
 * spoof-resistant IP resolution as the rate limiter (never a raw, client
 * controllable `x-forwarded-for`). `undefined` when no IP is resolvable so
 * downstream columns stay clean.
 */
export function getRequestMetadata(request: NextRequest): {
  ip?: string;
  userAgent?: string;
} {
  const ip = getClientIp(request);
  return {
    ip: ip === "unknown" ? undefined : ip,
    userAgent: request.headers.get("user-agent") || undefined,
  };
}
