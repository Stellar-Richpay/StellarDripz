/**
 * POST /api/wallet/disconnect — End the server-side session for an address.
 * Body: { address: string }
 *
 * Sessions are otherwise only pruned by the periodic cleanup (7-day TTL),
 * which means a "disconnected" wallet still counts as active in analytics
 * and session listings until then. Disconnecting on the client now mirrors
 * the local cleanup server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";
import { removeSession } from "@/lib/server/dbService";

export async function POST(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  try {
    const body = (await request.json()) as { address?: string };
    const address = body?.address?.trim();

    if (!address) {
      return NextResponse.json({ error: "address is required" }, { status: 400 });
    }
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    await removeSession(address);

    const response = NextResponse.json({ success: true });
    setCsrfCookie(response);
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to disconnect" },
      { status: 500 },
    );
  }
}