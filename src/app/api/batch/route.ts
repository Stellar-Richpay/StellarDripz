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
import { STELLAR_NETWORK } from "@/lib/stellar/network";
import { checkRateLimit } from "@/lib/server/rateLimiter";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";

const MAX_BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;

export async function POST(request: NextRequest) {
  try {
    // CSRF validation — this endpoint spends public faucet funds
    const csrfError = validateCsrf(request);
    if (csrfError) return csrfError;

    // Per-IP rate limiting (25 batches per minute)
    const rateLimitResponse = checkRateLimit(request, "general");
    if (rateLimitResponse) return rateLimitResponse;

    const body = (await request.json()) as { addresses?: string[] };
    const addresses = body?.addresses;

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
    const normalized = addresses.map((addr) => (typeof addr === "string" ? addr.trim() : ""));
    for (const addr of normalized) {
      if (!StellarSdk.StrKey.isValidEd25519PublicKey(addr)) {
        return NextResponse.json({ error: `Invalid address: ${addr}` }, { status: 400 });
      }
    }

    // Fund each address sequentially (Friendbot doesn't support batch)
    const results: {
      address: string;
      status: "success" | "error";
      hash?: string;
      error?: string;
    }[] = [];

    for (const address of normalized) {
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

    const response = NextResponse.json({
      total: results.length,
      succeeded,
      failed,
      results,
    });
    setCsrfCookie(response);
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}