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

---

## ADR-006: Contract Storage TTL Strategy and Cross-Contract Error Propagation

**Date:** 2026-09-09
**Status:** Accepted

### Context
The five Soroban contracts write user data and configuration to persistent
storage. Two failure modes threatened the deployed contracts:

1. **TTL expiry of config keys.** Soroban persistent entries written without
   an explicit extension carry the network default TTL of ~4096 ledgers —
   roughly 6 hours at ~5s ledgers. The token/pool/governance/badge contracts
   wrote their admin and config keys (`ADMIN`, `POOL_CFG`, `TOK_ID`,
   `VOT_PER`, ...) exactly once at init and almost never rewrote them, so
   every deployment was scheduled to lose its admin slot and configuration
   within hours of going quiet. Admin checks would read a zero address,
   metadata getters would fall back to defaults, and the pool would silently
   read an inactive default config.
2. **Dropped cross-contract `Result`s.** `execute()` and the pool's
   stake/unstake/claim/fund paths called other contracts via the generated
   clients and discarded the returned `Result`. Soroban does not auto-revert
   the caller's transaction when a cross-contract call returns `Err` — the
   error comes back as a value. A failed token transfer was therefore
   silently swallowed: `stake()` could record a phantom stake (rewards on
   tokens never deposited), `claim_reward()` could decrement the reward pool
   without paying out, and `execute()` could mark a proposal executed even
   though its action never ran.

### Decision
1. **Extend-on-read:** the shared `get_persistent` helper bumps the entry's
   TTL toward the ledger max on every successful read. Config stays alive for
   exactly as long as anyone interacts with the contract; an idle contract's
   entries still eventually expire and free rent. User data keeps the existing
   extend-on-write behavior (`set_and_extend`, ~1 year TTL).
2. **Propagate cross-contract errors:** every call to another contract uses
   the `try_` client variants and maps both error layers (`HostError` +
   contract error) to a typed error (`GovError::ActionFailed`,
   `PoolError::TransferFailed`). The pool's four token-touching operations and
   governance `execute()` now revert the whole transaction when the target
   contract rejects the call.

### Rationale
- Extend-on-read is the standard pattern for long-lived contract state and
  needs no per-contract bookkeeping: any read of a config key refreshes it.
- A failed cross-contract call and a successful one are indistinguishable to
  the caller unless the `Result` is handled; reverting on failure keeps
  on-chain accounting and off-chain expectations consistent.
- Up-front validation of governance action parameters (`propose()` rejects
  negative rates and zero-address mints) prevents doomed proposals from
  burning a full voting cycle.

### Consequences
- Every contract read of a config key now costs one `extend_ttl` host call
  (a no-op when the TTL is already above the threshold).
- Proposals whose actions fail now revert instead of being marked executed;
  proposers must fix the action's prerequisites (e.g. pool admin setup) and
  re-vote.
- Committed test snapshots reflect the extended `live_until` values; CI fails
  if `cargo test` leaves the snapshot tree dirty.

---

## ADR-007: SDK-27 Typed Contract Events

**Date:** 2026-09-09
**Status:** Accepted

### Context
All five contracts emitted events through `env.events().publish()`, which
soroban-sdk 27 marks deprecated. Beyond the deprecation warning, the shim's
ad-hoc `(symbol, addr, ...)` topic tuples had no compile-time shape — a
renamed field or a swapped argument changed the emitted event silently, and
off-chain indexers (the SSE `/api/events` stream, topic filters) had to know
the exact tuple layout by convention.

### Decision
1. Every event is now a `#[contractevent]` struct with `#[topic]` fields for
   the address/ID dimensions and plain fields for data.
2. Each struct pins its original event symbol via the macro's `topics =
   ["..."]` argument (e.g. `#[contractevent(topics = ["stake"])]`), so the
   **topic list is byte-identical to the pre-migration events** — off-chain
   topic filters and the SSE stream's topic strings are unchanged.
3. The deprecated `publish()` shim and the now-unused shared event symbol
   constants were deleted from `common/events.rs`; only the token transfer
   event remains there as a shared helper.

### Rationale
- Typed events give the compiler a say in the emitted shape: a struct field
  reorder or rename now shows up as a type error, not a silent on-chain
  change.
- Preserving the topic symbols means zero migration cost for anything already
  filtering on them, and the snapshots in `contracts/test_snapshots` pin the
  exact encoding — a new counter test compares the emitted event XDR to the
  struct's `to_xdr()` output.
- The data encoding differs (typed events emit a field-named map instead of a
  bare value), which matches what the token/counter contracts already emitted
  and is the SDK-27 standard.

### Consequences
- Event consumers reading raw `data` payloads must handle the field-map
  encoding; consumers filtering only on topics are unaffected.
- The deprecated shim is gone, so the SDK's deprecation warnings are gone
  and clippy runs clean.
- New events should be declared as `#[contractevent]` structs with explicit
  `topics` prefixes; the counter event-pinning test is the reference pattern.
