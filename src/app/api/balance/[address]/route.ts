/**
 * GET /api/balance/[address] — Fetch balance via Horizon
 */
import { NextRequest, NextResponse } from "next/server";
import { isValidStellarAddress } from "@/lib/stellar/address";
import { checkRateLimit, attachRateLimitHeaders } from "@/lib/server/rateLimiter";
import { fetchBalanceServer } from "@/lib/server/horizonService";
import { toHttpError } from "@/lib/server/http";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const rateLimitResponse = checkRateLimit(request, "general");
  if (rateLimitResponse) return rateLimitResponse;

  // Validate the Stellar address including the checksum (StrKey), not just the
  // character set — otherwise Horizon rejects it with a confusing 500 later.
  if (!isValidStellarAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const balance = await fetchBalanceServer(address);
    return attachRateLimitHeaders(
      request,
      NextResponse.json(balance, {
        headers: {
          // Account balances are account-specific and change with every
          // transaction — never let a shared cache serve another user's data.
          "Cache-Control": "private, no-store, max-age=0",
        },
      }),
      "general",
    );
  } catch (err) {
    // Production-safe error text (raw Horizon errors are logged, not echoed).
    const httpError = toHttpError(err);
    return NextResponse.json({ error: httpError.message }, { status: httpError.status });
  }
}
