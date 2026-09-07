/**
 * GET /api/history — Transaction history from database
 * Query: ?address=G...&type=faucet|send|contract&limit=50
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/server/rateLimiter";
import { getTransactions, type TxRecord } from "@/lib/server/dbService";

export async function GET(request: NextRequest) {
  // Rate limit history reads per IP — the endpoint can scan the DB and is
  // polled by clients.
  const rateLimitResponse = checkRateLimit(request, "general");
  if (rateLimitResponse) return rateLimitResponse;

  const url = new URL(request.url);
  const address = url.searchParams.get("address") || undefined;
  const type = url.searchParams.get("type") as TxRecord["type"] | null;
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

  const transactions = await getTransactions(address, type || undefined, limit, offset);

  return NextResponse.json({ transactions, total: transactions.length, offset, limit });
}
