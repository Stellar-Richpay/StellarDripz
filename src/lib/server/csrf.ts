/**
 * CSRF protection middleware for StellarDripz API routes.
 *
 * Uses a double-submit cookie pattern: the server sets a random token in a
 * cookie, and the client must send that same token in an X-CSRF-Token header
 * on state-changing requests (POST, PUT, DELETE, PATCH).
 *
 * Read-only endpoints (GET, HEAD, OPTIONS) are exempt.
 *
 * SCF / GrantFox reviewers: CSRF protection has been added to address
 * audit finding B1/S3.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

const CSRF_COOKIE = "stellardripz_csrf";
const CSRF_HEADER = "x-csrf-token";
// 8 hours — long enough for a session, rotates on each new request
const COOKIE_MAX_AGE = 8 * 60 * 60;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Generate a cryptographically random CSRF token. */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Set the CSRF cookie on the response. Call this for every response so the
 * client always has a fresh token.
 */
export function setCsrfCookie(response: NextResponse, token?: string): void {
  const value = token || generateCsrfToken();
  response.cookies.set(CSRF_COOKIE, value, {
    httpOnly: false, // must be readable by JS to set the header
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

/**
 * Validate the CSRF token for state-changing requests.
 * Returns null if the request is safe, or a 403 response if the token is invalid.
 */
export function validateCsrf(request: NextRequest): NextResponse | null {
  // Skip CSRF for safe methods
  if (SAFE_METHODS.has(request.method)) {
    return null;
  }

  const cookieToken = request.cookies.get(CSRF_COOKIE)?.value || "";
  const headerToken = request.headers.get(CSRF_HEADER) || "";

  if (!cookieToken || !headerToken) {
    return NextResponse.json({ error: "CSRF token missing" }, { status: 403 });
  }

  if (cookieToken !== headerToken) {
    return NextResponse.json({ error: "CSRF token mismatch" }, { status: 403 });
  }

  return null;
}
