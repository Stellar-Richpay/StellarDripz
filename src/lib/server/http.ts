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
  if (text.length > maxBytes) {
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

/** Convert any error into an HttpError (500 fallback keeps messages). */
export function toHttpError(err: unknown): HttpError {
  if (isHttpError(err)) return err;
  return new HttpError(500, err instanceof Error ? err.message : "Internal server error");
}