/**
 * Server-side rate limiting middleware.
 *
 * Uses in-memory Map with automatic cleanup every 5 minutes.
 *
 * ## Current Architecture
 * - Per-address tracking for faucet (1 req/min), payment (10/min), contract (5/min)
 * - Per-IP tracking for wallet (20/min) and general (30/min)
 * - Automatic cleanup of expired entries every 5 minutes
 * - Memory footprint: ~1KB per 100 active users (negligible)
 *
 * ## Scaling Path (SCF Tranche 2)
 * For multi-instance Vercel deployments (horizontal scaling), migrate to a shared
 * Redis store. Recommended approach:
 *
 * ```
 * npm install @upstash/ratelimit @upstash/redis
 * ```
 *
 * Then replace Map with:
 * ```ts
 * import { Ratelimit } from "@upstash/ratelimit";
 * import { Redis } from "@upstash/redis";
 *
 * const ratelimit = new Ratelimit({
 *   redis: Redis.fromEnv(),
 *   limiter: Ratelimit.slidingWindow(10, "60 s"),
 * });
 * ```
 *
 * The current implementation is sufficient for single-instance Vercel
 * deployments (<100 concurrent users) and local development.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/env";
import { MAINNET_RATE_LIMITS } from "@/lib/stellar/mainnet";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipMap = new Map<string, RateLimitEntry>();
const addressMap = new Map<string, RateLimitEntry>();

// Periodic cleanup every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of ipMap) {
      if (now > entry.resetAt) ipMap.delete(key);
    }
    for (const [key, entry] of addressMap) {
      if (now > entry.resetAt) addressMap.delete(key);
    }
  },
  5 * 60 * 1000,
);

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const TESTNET_LIMITS: Record<string, RateLimitConfig> = {
  faucet: { windowMs: 60_000, maxRequests: 1 }, // 1 per minute per address
  payment: { windowMs: 60_000, maxRequests: 10 }, // 10 per minute per address
  contract: { windowMs: 60_000, maxRequests: 5 }, // 5 per minute per address
  wallet: { windowMs: 60_000, maxRequests: 20 }, // 20 per minute per IP
  general: { windowMs: 60_000, maxRequests: 30 }, // 30 per minute per IP
};

/**
 * Network-aware defaults: mainnet deployments get the much stricter limits
 * from src/lib/stellar/mainnet.ts (1 faucet request per day, tighter
 * payment/contract/wallet buckets) because real XLM is at stake. Previously
 * MAINNET_RATE_LIMITS existed but was never wired into the rate limiter, so
 * a mainnet deploy silently ran with testnet limits.
 */
const DEFAULTS: Record<string, RateLimitConfig> = getAppConfig().isTestnet
  ? TESTNET_LIMITS
  : (MAINNET_RATE_LIMITS as Record<string, RateLimitConfig>);

/**
 * Check rate limit. Returns null if allowed, or a NextResponse with 429 if blocked.
 */
/** Clear all rate limit entries (for testing). */
export function clearRateLimits(): void {
  ipMap.clear();
  addressMap.clear();
}

/**
 * Resolve the client IP from the most trustworthy source available.
 *
 * `x-forwarded-for` is client-spoofable unless the proxy overwrites it, so
 * we prefer (in order): the platform-provided `request.ip` (populated by
 * Vercel/Next when trustProxy is enabled), then `x-real-ip` (set by nginx/
 * Vercel), and only then the first entry of `x-forwarded-for`. This prevents
 * attackers from rotating the header to bypass per-IP buckets.
 */
export function getClientIp(request: NextRequest): string {
  const platformIp = request.ip;
  if (platformIp) return platformIp;

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    // Take the left-most entry: the original client per RFC 7239 when the
    // proxy appends hop-by-hop addresses.
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }

  return "unknown";
}

/** Build the standard rate-limit headers for a bucket entry. */
function rateLimitHeaders(
  entry: RateLimitEntry | undefined,
  config: RateLimitConfig,
  now: number,
): Record<string, string> {
  const remaining =
    entry && now < entry.resetAt
      ? Math.max(0, config.maxRequests - entry.count)
      : config.maxRequests;
  const reset = entry ? Math.ceil((entry.resetAt - now) / 1000) : Math.ceil(config.windowMs / 1000);
  return {
    "X-RateLimit-Limit": String(config.maxRequests),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(reset),
  };
}

/** Merge rate-limit headers into a response. */
function withRateLimitHeaders(
  response: NextResponse,
  headers: Record<string, string>,
): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export function checkRateLimit(
  request: NextRequest,
  category: keyof typeof DEFAULTS,
  address?: string,
): NextResponse | null {
  const config = DEFAULTS[category] || DEFAULTS.general;
  const now = Date.now();

  if (address && (category === "faucet" || category === "payment" || category === "contract")) {
    // Per-address rate limiting
    const key = `${category}:${address}`;
    const entry = addressMap.get(key);

    if (entry && now < entry.resetAt) {
      if (entry.count >= config.maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return withRateLimitHeaders(
          NextResponse.json(
            { error: `Rate limited. Try again in ${retryAfter}s.`, retryAfter },
            { status: 429, headers: { "Retry-After": String(retryAfter) } },
          ),
          rateLimitHeaders(entry, config, now),
        );
      }
      entry.count++;
    } else {
      addressMap.set(key, { count: 1, resetAt: now + config.windowMs });
    }
  } else {
    // Per-IP rate limiting (fallback)
    const ip = getClientIp(request);
    const key = `${category}:${ip}`;
    const entry = ipMap.get(key);

    if (entry && now < entry.resetAt) {
      if (entry.count >= config.maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return withRateLimitHeaders(
          NextResponse.json(
            { error: "Too many requests.", retryAfter },
            { status: 429, headers: { "Retry-After": String(retryAfter) } },
          ),
          rateLimitHeaders(entry, config, now),
        );
      }
      entry.count++;
    } else {
      ipMap.set(key, { count: 1, resetAt: now + config.windowMs });
    }
  }

  return null; // Allowed
}

/**
 * Attach rate-limit headers to an allowed response for the given category.
 * Call after checkRateLimit returned null and the response is built.
 */
export function attachRateLimitHeaders(
  request: NextRequest,
  response: NextResponse,
  category: keyof typeof DEFAULTS,
  address?: string,
): NextResponse {
  const config = DEFAULTS[category] || DEFAULTS.general;
  const key = address ? `${category}:${address}` : `${category}:${getClientIp(request)}`;
  const entry = address ? addressMap.get(key) : ipMap.get(key);
  return withRateLimitHeaders(response, rateLimitHeaders(entry, config, Date.now()));
}
