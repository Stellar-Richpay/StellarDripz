/**
 * POST /api/faucet/fund — Rate-limited Friendbot funding with CSRF protection
 * Body: { address: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { isValidStellarAddress } from "@/lib/stellar/address";
import { checkRateLimit, attachRateLimitHeaders } from "@/lib/server/rateLimiter";
import { requestFaucetFundsServer } from "@/lib/server/horizonService";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";
import { parseJsonBody, toHttpError } from "@/lib/server/http";

export async function POST(request: NextRequest) {
  try {
    // CSRF validation for state-changing operations
    const csrfError = validateCsrf(request);
    if (csrfError) return csrfError;

    const body = await parseJsonBody(request);
    const address = typeof body.address === "string" ? body.address.trim() : undefined;

    if (!address) {
      return NextResponse.json({ error: "address is required" }, { status: 400 });
    }

    // Per-address rate limiting (1 per 60s)
    const rateLimitResponse = checkRateLimit(request, "faucet", address);
    if (rateLimitResponse) return rateLimitResponse;

    // Full StrKey checksum validation (not just the character set) — a
    // wrong-checksum address otherwise sails past the regex and comes back as
    // a confusing Friendbot 5xx instead of a clean 400.
    if (!isValidStellarAddress(address)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    const ip = request.headers.get("x-forwarded-for") || undefined;
    const ua = request.headers.get("user-agent") || undefined;

    const result = await requestFaucetFundsServer(address, { ip, userAgent: ua });

    const response = attachRateLimitHeaders(
      request,
      NextResponse.json({
        success: true,
        hash: result.hash,
        newBalance: result.newBalance,
      }),
      "faucet",
      address,
    );
    setCsrfCookie(response);
    return response;
  } catch (err) {
    const httpError = toHttpError(err);
    return NextResponse.json({ error: httpError.message }, { status: httpError.status });
  }
}
