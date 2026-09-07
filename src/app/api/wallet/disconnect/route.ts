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
import { isValidStellarAddress } from "@/lib/stellar/address";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";
import { removeSession } from "@/lib/server/dbService";
import { parseJsonBody, toHttpError } from "@/lib/server/http";

export async function POST(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  try {
    const body = await parseJsonBody(request);
    const address = typeof body.address === "string" ? body.address.trim() : undefined;

    if (!address) {
      return NextResponse.json({ error: "address is required" }, { status: 400 });
    }
    if (!isValidStellarAddress(address)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    await removeSession(address);

    const response = NextResponse.json({ success: true });
    setCsrfCookie(response);
    return response;
  } catch (err) {
    const httpError = toHttpError(err);
    return NextResponse.json({ error: httpError.message }, { status: httpError.status });
  }
}
