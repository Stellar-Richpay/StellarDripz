/**
 * Edge middleware — bootstraps the CSRF double-submit cookie.
 *
 * The server-side CSRF check (src/lib/server/csrf.ts) requires the
 * `stellardripz_csrf` cookie to be present on every state-changing request.
 * Previously the cookie was only set on the *response* of the first POST,
 * so the very first POST from a fresh browser was rejected with 403
 * "CSRF token missing" and no UI could ever recover.
 *
 * This middleware sets the cookie on every API response when the client
 * does not already have one, guaranteeing the token exists before the
 * first state-changing call. The client echoes it via the X-CSRF-Token
 * header (src/lib/client/apiClient.ts).
 *
 * Security: sameSite=strict blocks cross-site sends, httpOnly=false is
 * required because JS must read the value to echo it as a header, and
 * secure is forced in production so the token never travels over HTTP.
 */
import { NextRequest, NextResponse } from "next/server";

const CSRF_COOKIE = "stellardripz_csrf";
const COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours, matches src/lib/server/csrf.ts

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (!request.cookies.get(CSRF_COOKIE)?.value) {
    response.cookies.set(CSRF_COOKIE, crypto.randomUUID(), {
      httpOnly: false,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }

  // Correlate every API call across logs, rate-limiter records, and client
  // debugging. Honor an upstream X-Request-Id (proxies/load balancers) so
  // traces stay consistent end to end; otherwise mint one per request.
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  response.headers.set("x-request-id", requestId);

  // API responses are wallet data: balances, transactions, and cooldowns
  // change the moment a payment lands. Letting a browser cache or a shared
  // proxy serve a stale copy could show a user an outdated balance or a
  // status page pretending to be healthy. Disable caching for the API layer
  // entirely — the app is interactive, so there is nothing to gain from it.
  response.headers.set("Cache-Control", "no-store");

  return response;
}

export const config = {
  // Only API routes need the token; pages are protected by SameSite cookies
  // and the header-based CSRF only applies to state-changing API calls.
  matcher: ["/api/:path*"],
};
