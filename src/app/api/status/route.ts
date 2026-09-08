/**
 * Network health check endpoint.
 * GET /api/status
 */
import { NextRequest, NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "@/lib/stellar/network";
import { checkRateLimit, attachRateLimitHeaders } from "@/lib/server/rateLimiter";

export async function GET(request: NextRequest) {
  // Every request triggers three external probes, so it must be capped per IP
  // — an unauthenticated caller could otherwise use this endpoint to drive
  // unbounded outbound traffic to Horizon/RPC/Friendbot.
  const rateLimitResponse = checkRateLimit(request, "general");
  if (rateLimitResponse) return rateLimitResponse;

  const results: Record<
    string,
    {
      status: "ok" | "error";
      latency?: number;
      error?: string;
      httpStatus?: number;
      /** Set when the service doesn't apply to the configured network. */
      disabled?: boolean;
    }
  > = {};

  // Check Horizon
  try {
    const start = Date.now();
    const horizon = new StellarSdk.Horizon.Server(STELLAR_NETWORK.horizonUrl);
    await horizon.ledgers().limit(1).call();
    results.horizon = { status: "ok", latency: Date.now() - start };
  } catch (err) {
    results.horizon = {
      status: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  // Check Soroban RPC
  try {
    const start = Date.now();
    const rpc = new StellarSdk.rpc.Server(STELLAR_NETWORK.sorobanRpcUrl);
    await rpc.getLatestLedger();
    results.sorobanRpc = { status: "ok", latency: Date.now() - start };
  } catch (err) {
    results.sorobanRpc = {
      status: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  // Check Friendbot reachability. Friendbot only exists on test networks, so
  // a mainnet deployment skips the probe and reports the service as disabled
  // rather than showing a healthy status for an endpoint the app can't use.
  if (STELLAR_NETWORK.network !== "TESTNET") {
    results.friendbot = { status: "ok", disabled: true };
  } else {
    // Friendbot only serves funded/creating accounts, so we can't ping it with
    // an arbitrary address (it rejects unknown accounts with 4xx). Instead we
    // verify the service is reachable: any HTTP response (even 4xx/5xx from the
    // root path) proves the endpoint is up.
    try {
      const start = Date.now();
      const res = await fetch(`${STELLAR_NETWORK.friendbotUrl}/`, {
        signal: AbortSignal.timeout(5000),
      });
      // A resolved fetch means Friendbot is reachable. The root path returns 4xx
      // for requests without an account (expected), so treat <500 as healthy
      // while flagging genuine server errors (5xx).
      results.friendbot = {
        status: res.status < 500 ? "ok" : "error",
        latency: Date.now() - start,
        httpStatus: res.status,
      };
    } catch (err) {
      results.friendbot = {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  return attachRateLimitHeaders(
    request,
    NextResponse.json(
      {
        timestamp: new Date().toISOString(),
        network: STELLAR_NETWORK.network,
        services: results,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    ),
    "general",
  );
}
