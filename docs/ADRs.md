# Architecture Decision Records — StellarDripz

## ADR-001: Hybrid Read/Write Architecture

**Date:** 2026-07-01
**Status:** Accepted

### Context
Stellar dApps can access Horizon and Soroban RPC either client-side (lower latency) or server-side (better security). We need to decide the access pattern.

### Decision
- **Reads:** Direct client → Stellar (Horizon balances, Soroban simulations)
- **Writes:** Proxied through Next.js API routes with rate limiting and CSRF

### Rationale
- Reads are latency-sensitive and don't need auth gating
- Writes (faucet, payments, contract invocations) benefit from rate limiting and audit logging
- API routes allow us to add Supabase persistence for transaction history

### Consequences
- Client needs to handle direct Horizon/RPC failures
- API routes add ~50ms latency to write operations
- Dual authentication model: client wallet for tx signing, API for rate limiting

---

## ADR-002: Multi-Contract Architecture with Shared Storage

**Date:** 2026-08-01
**Status:** Accepted

### Context
We need 5 smart contracts (Counter, Token, Pool, Governance, Badge) with cross-contract communication. Should we use a monolithic contract or separate contracts?

### Decision
Separate contracts with shared `common/` module for storage keys, events, and constants.

### Rationale
- Each contract has independent lifecycle and admin
- Cross-contract calls via generated clients (Soroban SDK pattern)
- Shared `common/` avoids duplication without coupling
- Easier to audit and upgrade individual contracts

### Consequences
- Each contract needs its own WASM deployment (5 separate instances)
- Cross-contract auth requires explicit `set_minter` / admin setup
- Storage namespace collisions prevented by per-contract key prefixes

---

## ADR-003: In-Memory Rate Limiting with Redis Migration Path

**Date:** 2026-08-11
**Status:** Accepted

### Context
We need rate limiting for faucet (1/min), payments (10/min), and contract calls (5/min). Options: in-memory, file-based, or Redis.

### Decision
In-memory Map with documented migration path to Upstash Redis for production.

### Rationale
- Vercel single-instance deployments don't need shared state
- In-memory has zero external dependencies and works in all environments
- Redis migration path documented with complete code examples
- Cleanup interval (5 min) prevents memory leaks

### Consequences
- Rate limits reset on server restart (acceptable for testnet)
- Multi-instance deployments need Redis migration
- Memory usage is ~1KB per 100 active users (negligible)

---

## ADR-004: CSP with unsafe-inline for Wallet SDK Compatibility

**Date:** 2026-08-11
**Status:** Accepted

### Context
Stellar wallet SDKs (Albedo, xBull) require `unsafe-eval` and `unsafe-inline` in CSP. Should we accept this or use nonces?

### Decision
Accept `unsafe-inline`/`unsafe-eval` with defense-in-depth via other headers.

### Rationale
- Wallet SDKs inject dynamic scripts at runtime (iframe-based flows)
- Nonce-based CSP would break wallet popups/iframes
- Defense-in-depth via `X-Frame-Options`, `frame-ancestors 'self'`, `form-action 'self'`
- All wallet interactions are user-initiated and scoped to testnet

### Consequences
- CSP is weaker than ideal but still provides meaningful protection
- `frame-ancestors 'self'` prevents clickjacking
- `base-uri 'self'` prevents base tag injection
- Future: evaluate nonce approach when wallet SDKs support it

---

## ADR-005: Runtime Config Overrides and Stream Guards

**Date:** 2026-09-08
**Status:** Accepted

### Context
Operators need to tune rate limits and log verbosity without code changes,
and the SSE event endpoint holds connections open indefinitely — a burst of
tabs (or an attacker) can exhaust a serverless function pool.

### Decision
1. Rate-limit windows for the `payment`, `wallet`, `faucet`, and `general`
   buckets are configurable via `RATE_LIMIT_WINDOW_*` environment variables.
2. `LOG_LEVEL` is validated against the known levels (`debug|info|warn|error`)
   and applied at startup via `setLogLevel`; unrecognized values are rejected
   instead of silently disabling all logging through an invalid cast.
3. The SSE events endpoint caps concurrent streams per IP (`MAX_STREAMS_PER_IP
   = 5`); each stream's poll interval is clamped to 1–60s, and slot release is
   idempotent so a double disconnect cannot undercount active streams.

### Rationale
- Deploy-time tuning avoids redeploys for operational knobs; documented in
  `.env.example`.
- An invalid `LOG_LEVEL` previously passed the type cast and silently turned
  every logger call into a no-op.
- Without a stream cap, N tabs per visitor multiply into unbounded function
  invocations; the idempotent release guards against drift in the accounting.

### Consequences
- Default windows still apply when the env vars are absent (no behavior change
  for existing deployments).
- SSE streams remain capped per IP; legitimate multi-tab users may hit the cap
  and see a 429 with a clear message.
