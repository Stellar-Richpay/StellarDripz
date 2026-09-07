/**
 * POST /api/wallet/connect — Validate wallet and create session
 * Body: { address: string, walletId: string, walletName: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/server/rateLimiter";
import { createSession } from "@/lib/server/sessionManager";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";

export async function POST(request: NextRequest) {
  // CSRF validation — this endpoint creates a server-side session
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  // Rate limit
  const rateLimitResponse = checkRateLimit(request, "wallet");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = (await request.json()) as {
      address?: string;
      walletId?: string;
      walletName?: string;
    };

    const { address, walletId, walletName } = body;
    if (!address || !walletId) {
      return NextResponse.json({ error: "address and walletId are required" }, { status: 400 });
    }

    // Validate Stellar address format
    if (!/^G[A-Z2-7]{55}$/.test(address)) {
      return NextResponse.json({ error: "Invalid Stellar address" }, { status: 400 });
    }

    const ip = request.headers.get("x-forwarded-for") || undefined;
    const ua = request.headers.get("user-agent") || undefined;

    const session = await createSession(address, walletId, walletName || walletId, { ip, userAgent: ua });

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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create session" },
      { status: 500 },
    );
  }
}
