/**
 * POST /api/wallet/connect — Validate wallet and create session
 * Body: { address: string, walletId: string, walletName: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/server/rateLimiter";
import { isValidStellarAddress } from "@/lib/stellar/address";
import { createSession } from "@/lib/server/sessionManager";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";
import { parseJsonBody, toHttpError, getRequestMetadata } from "@/lib/server/http";

/** Known wallet IDs the dApp supports — reject anything else up front. */
const SUPPORTED_WALLET_IDS = new Set(["freighter", "xbull", "albedo", "lobstr", "walletconnect"]);

/** Cap wallet display names so sessions/analytics rows can't be bloated. */
const MAX_WALLET_NAME_LENGTH = 120;

export async function POST(request: NextRequest) {
  // CSRF validation — this endpoint creates a server-side session
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  // Rate limit
  const rateLimitResponse = checkRateLimit(request, "wallet");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const parsedBody = await parseJsonBody(request);
    const body = {
      address: typeof parsedBody.address === "string" ? parsedBody.address : undefined,
      walletId: typeof parsedBody.walletId === "string" ? parsedBody.walletId : undefined,
      walletName: typeof parsedBody.walletName === "string" ? parsedBody.walletName : undefined,
    };

    const { address, walletId, walletName } = body;
    if (!address || !walletId) {
      return NextResponse.json({ error: "address and walletId are required" }, { status: 400 });
    }

    // Only accept wallet IDs this dApp actually integrates — otherwise
    // arbitrary strings land in the sessions table and analytics.
    if (!SUPPORTED_WALLET_IDS.has(walletId)) {
      return NextResponse.json({ error: "Unsupported wallet" }, { status: 400 });
    }

    // Validate Stellar address with the StrKey checksum — the character regex
    // alone lets malformed addresses pollute the sessions table and analytics.
    if (!isValidStellarAddress(address)) {
      return NextResponse.json({ error: "Invalid Stellar address" }, { status: 400 });
    }
    if (walletName && walletName.length > MAX_WALLET_NAME_LENGTH) {
      return NextResponse.json(
        { error: `walletName must be ${MAX_WALLET_NAME_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    const { ip, userAgent } = getRequestMetadata(request);

    const session = await createSession(address, walletId, walletName || walletId, {
      ip,
      userAgent,
    });

    const response = NextResponse.json({
      success: true,
      session: {
        address: session.address,
        walletId: session.walletId,
        connectedAt: session.connectedAt,
      },
    });
    setCsrfCookie(response);
    return response;
  } catch (err) {
    const httpError = toHttpError(err);
    return NextResponse.json({ error: httpError.message }, { status: httpError.status });
  }
}
