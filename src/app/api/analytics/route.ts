/**
 * GET /api/analytics — Analytics data from database
 * Query: ?type=faucet_request|payment_send|contract_invoke|wallet_connect
 *
 * Security:
 * - Rate-limited per IP (the summary endpoint aggregates all usage).
 * - When ADMIN_API_TOKEN is set in the environment, requests must present it
 *   via `Authorization: Bearer <token>` (or `x-admin-token` header); without
 *   the env var the endpoint stays open for local/dev deployments but should
 *   always be protected in production.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/server/rateLimiter";
import { getAnalytics, getAnalyticsSummary, type AnalyticsEntry } from "@/lib/server/dbService";

/** Compare tokens in constant time to avoid timing side channels. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return true; // No token configured — open (dev/local).
  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-admin-token") ||
    "";
  return timingSafeEqual(header, expected);
}

export async function GET(request: NextRequest) {
  // Rate limit every analytics read (data can be large and is polled).
  const rateLimitResponse = checkRateLimit(request, "general");
  if (rateLimitResponse) return rateLimitResponse;

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const summary = url.searchParams.get("summary") === "true";

  // Reject unknown event types up front: an invalid filter previously fell
  // through to the DB as a wildcard match, silently returning an empty list
  // instead of telling the caller the filter is wrong.
  const rawType = url.searchParams.get("type");
  if (rawType !== null) {
    const VALID_TYPES: AnalyticsEntry["eventType"][] = [
      "faucet_request",
      "payment_send",
      "contract_invoke",
      "wallet_connect",
      "balance_fetch",
    ];
    if (!VALID_TYPES.includes(rawType as AnalyticsEntry["eventType"])) {
      return NextResponse.json(
        { error: `Invalid event type: ${rawType}` },
        { status: 400 },
      );
    }
  }
  const eventType = rawType as AnalyticsEntry["eventType"] | null;

  if (summary) {
    const data = await getAnalyticsSummary();
    return NextResponse.json({ summary: data });
  }

  const entries = await getAnalytics(eventType || undefined);
  return NextResponse.json({ events: entries, total: entries.length });
}
