/**
 * Batch funding endpoint.
 * POST /api/batch
 * Body: { addresses: string[] }
 *
 * Hardened: CSRF-protected, rate-limited per IP, checksum-validates every
 * address (StrKey, not just the character regex) before any Friendbot call,
 * and caps the batch size.
 */
import { NextRequest, NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { isValidStellarAddress } from "@/lib/stellar/address";
import { STELLAR_NETWORK } from "@/lib/stellar/network";
import { checkRateLimit, attachRateLimitHeaders } from "@/lib/server/rateLimiter";
import { assertFaucetAllowed } from "@/lib/server/horizonService";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";
import { parseJsonBody, toHttpError } from "@/lib/server/http";

const MAX_BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;
// Hard deadline for the whole batch. Ten Friendbot calls with a 10s timeout
// each can run to ~105s, far past a serverless function's wall-clock budget
// — on Vercel's Hobby tier a 10s batch would be killed mid-loop with no
// per-address results at all. Once the deadline passes, remaining addresses
// are reported as skipped instead of silently dropped.
const BATCH_DEADLINE_MS = 25_000;

export async function POST(request: NextRequest) {
  try {
    // CSRF validation — this endpoint spends public faucet funds
    const csrfError = validateCsrf(request);
    if (csrfError) return csrfError;

    // Mainnet has no faucet — fail fast with a clear message.
    try {
      assertFaucetAllowed();
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Faucet unavailable" },
        { status: 400 },
      );
    }

    // Per-IP rate limiting (25 batches per minute)
    const rateLimitResponse = checkRateLimit(request, "general");
    if (rateLimitResponse) return rateLimitResponse;

    const body = await parseJsonBody(request);
    const addresses = Array.isArray(body.addresses) ? body.addresses : undefined;

    if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json({ error: "addresses array is required" }, { status: 400 });
    }

    if (addresses.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BATCH_SIZE} addresses per batch request` },
        { status: 400 },
      );
    }

    // Validate all addresses with StrKey checksum — the regex alone accepts
    // addresses that Horizon later rejects with a confusing 5xx.
    const normalized = [
      ...new Set(addresses.map((addr) => (typeof addr === "string" ? addr.trim() : ""))),
    ];
    for (const addr of normalized) {
      if (!isValidStellarAddress(addr)) {
        return NextResponse.json({ error: `Invalid address: ${addr}` }, { status: 400 });
      }
    }

    // A duplicate address in one batch would be funded twice (or 429 on the
    // second call); dedupe before funding and report the effective count.

    // Fund each address sequentially (Friendbot doesn't support batch)
    const results: {
      address: string;
      status: "success" | "error";
      hash?: string;
      error?: string;
    }[] = [];

    const batchStart = Date.now();
    for (const address of normalized) {
      // Once the batch deadline passes, stop making new Friendbot calls and
      // report the rest as skipped — a partial, explicit result set beats a
      // function timeout that returns nothing at all.
      if (Date.now() - batchStart > BATCH_DEADLINE_MS) {
        results.push({
          address,
          status: "error",
          error: "Skipped — batch deadline reached, retry the remaining addresses",
        });
        continue;
      }
      try {
        const url = `${STELLAR_NETWORK.friendbotUrl}?addr=${encodeURIComponent(address)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          results.push({
            address,
            status: "error",
            error: data?.detail || data?.title || `HTTP ${res.status}`,
          });
        } else {
          const data = await res.json();
          results.push({
            address,
            status: "success",
            hash: data?.hash || data?.transaction_hash || null,
          });
        }

        // Small delay between requests to avoid Friendbot rate limiting
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      } catch (err) {
        results.push({
          address,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const succeeded = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "error").length;

    // Attach X-RateLimit-* headers like every other rate-limited route, so
    // clients that poll batch funding can back off before hitting a 429.
    const response = attachRateLimitHeaders(
      request,
      NextResponse.json({
        total: results.length,
        succeeded,
        failed,
        results,
      }),
      "general",
    );
    setCsrfCookie(response);
    return response;
  } catch (err) {
    const httpError = toHttpError(err);
    return NextResponse.json({ error: httpError.message }, { status: httpError.status });
  }
}
