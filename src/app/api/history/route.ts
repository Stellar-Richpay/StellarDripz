/**
 * GET /api/history — Transaction history from database
 * Query: ?address=G...&type=faucet|send|contract&limit=50&offset=0
 *
 * Returns the requested page plus the true filtered total and a hasMore flag
 * so clients can implement "load more" without over-fetching or guessing.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, attachRateLimitHeaders } from "@/lib/server/rateLimiter";
import { getTransactions, getTransactionsCount, type TxRecord } from "@/lib/server/dbService";
import { isValidStellarAddress } from "@/lib/stellar/address";

export async function GET(request: NextRequest) {
  // Rate limit history reads per IP — the endpoint can scan the DB and is
  // polled by clients.
  const rateLimitResponse = checkRateLimit(request, "general");
  if (rateLimitResponse) return rateLimitResponse;

  const url = new URL(request.url);
  const rawAddress = url.searchParams.get("address") || undefined;
  // A malformed address filter can never match anything in the DB — reject it
  // as a 400 instead of silently returning an empty page that looks like a
  // real "no transactions" result.
  if (rawAddress && !isValidStellarAddress(rawAddress)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  const address = rawAddress;
  const rawType = url.searchParams.get("type");
  // NaN-safe clamping: a non-numeric limit/offset (or one out of range)
  // must fall back to sane defaults, not propagate NaN into the query.
  const rawLimit = parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
  const rawOffset = parseInt(url.searchParams.get("offset") || "", 10);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  // Validate the type filter rather than passing an arbitrary string to the
  // DB layer (which silently matches nothing).
  if (rawType !== null) {
    const VALID_TYPES: TxRecord["type"][] = ["faucet", "send", "contract"];
    if (!VALID_TYPES.includes(rawType as TxRecord["type"])) {
      return NextResponse.json({ error: `Invalid type: ${rawType}` }, { status: 400 });
    }
  }
  const type = rawType as TxRecord["type"] | null;

  const [transactions, total] = await Promise.all([
    getTransactions(address, type || undefined, limit, offset),
    getTransactionsCount(address, type || undefined),
  ]);

  return attachRateLimitHeaders(
    request,
    NextResponse.json({
      transactions,
      total,
      offset,
      limit,
      hasMore: offset + transactions.length < total,
    }),
    "general",
  );
}
