# Changelog

All notable changes to StellarDripz are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — 2026-09 hardening wave (contract-invoke & rate-limit)

### Added
- **Payment/wallet rate-limit overrides**: `RATE_LIMIT_PAYMENT_MS` and `RATE_LIMIT_WALLET_MS` now widen testnet buckets like the existing three overrides (documented in both `.env` templates; mainnet still ignores all overrides)
- **Rate-limit headers on reads**: `/api/balance`, `/api/history`, `/api/status`, `/api/analytics` attach `X-RateLimit-*` headers to successful responses so pollers can back off before hitting a 429
- **Client request timeout**: proxied API calls abort after 25s with a readable error instead of spinning forever on a hung upstream
- **Contract tests**: allowance-expiry boundary coverage, past-expiration rejection, and pool `min <= max` parameter guards (61 contract tests total)

### Changed
- **Exact ScVal integers**: contract-invoke arguments are converted with BigInt math and per-type range checks — i128/u128 values above 2^53 are no longer silently rounded, and overflow/negative values are rejected with a 400 instead of wrapping
- **Arg errors are client errors**: malformed contract-invoke arguments return 400s with the specific reason rather than a generic production 500
- **`approve(0)` prunes**: revoking a token allowance deletes the stored record instead of keeping a zero-value entry alive
- **Byte-accurate body cap**: the JSON request-body limit is enforced on UTF-8 bytes, not UTF-16 code units

### Fixed
- **Byte-accurate memo validation**: the send form measures text memos in UTF-8 bytes (28-byte protocol limit) instead of characters, matches the server's validator, and disables submit while the memo is invalid
- **Badge metadata bounds**: badge name/description/image_uri are capped at 64/256/256 bytes with a typed `MetadataTooLong` error, and user badges gained paged listing
- **Freighter network probe**: a failed network read reports UNKNOWN instead of a guessed TESTNET, so mainnet deployments no longer false-trigger the mismatch guard
- **WalletConnect metadata**: the pairing description now matches the configured network instead of always saying "testnet"
- **Client tx ids**: send/faucet ids gained a random suffix so same-millisecond actions can't collide in the transaction list
- **In-memory history paging**: the memory backend now caps pages at 100 like the Supabase backend
- **Version fingerprinting**: `X-Powered-By` is disabled so the Next.js version isn't advertised
- **Event duplicate stacking**: the direct-poll fallback dedupes across polling rounds via a persistent seen-keys set (each round previously re-added the same on-chain events), and a failed latest-ledger probe no longer replays history from ledger 0
- **Unfunded-account copy**: the "use the faucet" hint is testnet-only — on mainnet it referenced a hard-disabled button
- **Network badge on mobile**: the wallet-vs-app network warning is no longer hidden below the `sm` breakpoint
- **Greeting byte cap**: the Soroban demo disables Set with an inline error when the greeting exceeds the contract's 512-byte limit
- **Address-book bounds**: labels capped at 40 chars and 100 entries max (oldest evicted) so localStorage can't grow without limit
- **API caching**: the middleware stamps `Cache-Control: no-store` on all API responses so balances/history can never be served stale
- **Native form validation**: the send form uses `noValidate` so styled inline errors win over the browser's confusing step/constraint tooltip
- **Signer validation**: the contract-invoke route rejects signer addresses that fail the StrKey checksum, and submitted contract XDRs must originate from the claimed signer before they are simulated or logged
- **Native-asset issuer**: payment payloads that combine an issuer with XLM (or no asset code) are rejected instead of silently dropping the issuer
- **useWallet lifecycle**: reconnect/connect results no longer update state or fire backend registration after the hook unmounts
- **Pool config**: `min_stake` above `max_stake` is rejected at init and in admin setters, so staking can't be silently bricked
- **Expired-allowance branch**: removed the misleading `remove()` in `transfer_from`'s error path (a failed Soroban call rolls back writes, so it could never persist) and pinned the real semantics in tests

### Security
- **Envelope-source verification**: `/api/contract/invoke` now rejects a signed XDR whose source account differs from the claimed signer, closing a forged-attribution hole on par with the payment route

### Tests
- **Badge coverage**: metadata length bounds, user-badge pagination, admin-gated mutations, and initialization guards are pinned
- **Format helpers**: the shared amount formatters gained a unit suite (decimals, non-finite inputs, large balances)
- **E2E updates**: payment API tests use the current request shape, the issuer-on-XLM rejection is covered, and the no-store cache policy is asserted end to end
- **Pool coverage**: lock-period enforcement (TokensLocked), claim_reward payout accounting, fund_rewards admin gate, and inactive-pool stake rejection are now pinned
- **Governance coverage**: vote-at-voting-end boundary, execute-while-voting-active rejection, and the proposal minimum-voting-power gate (incl. exact-boundary semantics)
- **Counter coverage**: greeting size limit pinned as byte-exact (512 accepted / 513 rejected, multi-byte UTF-8 included)

### Chore
- **Dead code**: removed the unused AsyncBoundary/Skeleton modules and the `withErrorBoundary` HOC; `data/` (runtime JSON DB with IPs) is gitignored; the CI prettier step now format-checks `e2e/` via the canonical script

---

## [Unreleased]

### Added
- **Env-driven rate limits**: `RATE_LIMIT_*` vars now actually widen testnet buckets (lazily, NaN-proof); wrong-network guards and network-aware metadata/copy throughout (layout, footer, hero, feature cards, balance errors, QR-fund button)
- **API route tests**: New suites for `api-batch`, `api-status`, `api-analytics`, and `api-events` (guard branches + polyfilled web-stream globals)
- **Shared network guard**: `networkGuard.ts` compares wallet vs. app network; used by SendForm, SorobanDemo, NetworkWarning
- **Health dedupe**: Concurrent `/api/health` probes coalesce into one round of external calls (in-flight cache)
- **Shared asset decimals**: `assetDecimals()` centralizes 7/12-digit rules; send validator honors real alphanum4 vs alphanum12 precision
- **Payment-request asset QRs**: SEP-7 payment QRs encode `asset_code`/`asset_issuer` for credit assets

### Fixed
- **Rate-limit gaps**: Contract simulate/build and payment build branches now consume the per-IP general bucket (were unrate-limited RPC/Horizon drivers)
- **Silent reconnect failures**: Persisted-wallet auto-reconnect surfaces the reason; backend registration failure no longer clears a working wallet session (useWallet + AppContext)
- **Mainnet copy bugs**: Testnet-only faucet references removed from disconnected feature cards, balance errors, layout metadata/footer, and the Friendbot QR-fund button

### Security
- **RPC-cost abuse**: Simulation/build endpoints rate-limited per IP so unauthenticated callers can't burn Soroban RPC or Horizon credits

---

## [Unreleased] — hardening wave (post 2.2.0)

### Added
- **CSRF protection**: Double-submit cookie pattern on all state-changing POST endpoints (faucet, payment, contract)
- **Contract ID validation**: `isValidContractId()` with Stellar checksum verification and user-friendly error messages
- **`getWalletConnectStatus()`**: Returns availability + human-readable message when project ID is missing (W2)
- **SCF roadmap**: 4-tranche milestone plan in `docs/SCF_ROADMAP.md` for GrantFox/SCF submissions

### Fixed
- **P0: Governance MintTokens cross-contract bug (C8)**: DripToken now supports `set_minter()` — admin can authorize governance contract to mint tokens. Governance `MintTokens` action works correctly.
- **P0: Checked arithmetic (C1)**: All contract arithmetic now uses `checked_add`/`checked_sub`/`checked_mul` instead of bare `+`/`-`/`*` operators across token, pool, badge, and governance contracts
- **P1: Contract errors (C7)**: Added `#[contracterror]` enums (TokenError, PoolError, BadgeError) for machine-parseable error codes
- **P1: Duplicate token tests (C2/T2)**: Removed 4 duplicate tests from `contracts/src/test.rs`; token tests live only in `token/mod.rs`
- **P1: Dead code cleanup (C5/C6)**: Removed unused `KEY_ALLOWANCE`, `KEY_STAKE`, `KEY_PROPOSAL`, `KEY_BADGE` storage keys; removed dead `get_instance`, `set_instance`, `require_admin` helpers
- **P1: CSP hardening (S4)**: Added `form-action 'self'` and `base-uri 'self'` directives; removed broad `frame-src https:`
- **P2: Deployer key removal (S5)**: `.env.local` deployer key replaced with placeholder comment
- **P2: FUNDING.yml cleanup (O4)**: Replaced stale contract ID with project URL
- **P2: Env tests (T1)**: Fixed 2 failing tests that expected null contract IDs after deployment
- **P2: WalletConnect messaging (W2)**: `getWalletConnectStatus()` shows helpful message instead of silent disable
- **P2: Contract ID input validation (F2)**: Frontend now validates Stellar contract ID checksum before submission

### Changed
- **README**: Deployed contract IDs table with live Stellar Expert explorer links (all 5 contracts deployed to testnet); SEP-41 labeling updated to "SEP-41 inspired"
- **Contracts deployed**: All 5 contracts live on Stellar Testnet at ledger 4,085,848
- **Token minter pattern**: New `set_minter`/`get_minter` API for delegating mint authority (governance integration)
- **Rust edition**: Clean build with zero warnings (removed unused `Address` import from `storage.rs`)

### Security
- **CSRF tokens**: All POST endpoints now validate `x-csrf-token` header against `stellardripz_csrf` cookie
- **Checked arithmetic**: Overflow/underflow panics now use `.expect()` with descriptive messages
- **Contract error codes**: Machine-parseable `#[contracterror]` enums replace bare `panic!()` strings

---

## [Unreleased] — hardening wave (post 2.2.0)

### Added
- **Payment memos**: Full end-to-end memo support (validation on build+submit, wallet signing, persisted transaction records, history display)
- **Governance quorum**: Basis-point participation threshold enforced before proposals pass; `set_quorum`/`get_quorum` admin API
- **TTL maintenance**: Threshold-based `extend_ttl` on every persistent write across token/pool/governance/badge so balances and state never expire
- **Read APIs**: `get_reward_pool` (pool), paginated `list_proposals` (governance), paginated badge listing, `SetMaxStake` governance action, governance + pool fuzz tests
- **History pagination**: `GET /api/history` returns true filtered `total` + `hasMore`; new `getTransactionsCount`
- **Request correlation**: `X-Request-Id` minted/echoed on all API responses and attached to client errors
- **Concurrent SSE caps**: Per-IP stream limits (429 past 5) and poll-interval clamping on `/api/events`
- **Network-fee surfacing**: Built payment fee returned in stroops and shown on send transaction rows
- **Explorer deep links**: Connected wallet address and transaction recipients link out to StellarExpert
- **Balance auto-refresh**: Visibility/focus listener refreshes balances (15s throttle) when the tab returns
- **Dependabot**: Weekly grouped updates for npm, cargo, and GitHub Actions

### Changed
- **Address validation**: Shared `isValidStellarAddress` (StrKey checksum) now used by faucet and wallet-connect routes, which previously accepted any well-formed G-address
- **Dedup consolidation**: Shared address/format/explorer/clipboard/storage utilities; removed dead client modules (soroban, horizon, events, db) and unused wallet pub/sub
- **Form safety**: Failed sends no longer clear the form; submit disabled state now respects inline validation
- **Tooling**: `npm run verify` (lint + typecheck + test + format) and `verify:contracts` (fmt + clippy + test); prettier/rustfmt/clippy wired into scripts and CI; stricter tsconfig flags
- **Coverage gate**: Local `jest --coverage` thresholds aligned with CI (45/50/55/55)

### Fixed
- **Wrong-network guard**: Soroban demo writes now disabled on Mainnet wallets, matching Send/Faucet
- **Contract exports**: Unique per-contract export names in the shared WASM (fixed `version()` collisions across all five contracts)
- **Repo hygiene**: Build artifacts under `contracts/target/` untracked

### Security
- **SSE abuse**: Concurrent-stream caps prevent connection exhaustion

---

## [2.2.0] — 2026-08-09

### Added
- **`constants.rs`**: Shared module with `ZERO_ADDRESS_STR` sentinel for all contracts
- **Governance actions**: `propose()` now accepts `GovernanceAction` parameter for on-chain execution
- **`checkWalletStillConnected()`**: Detects wallet extension disconnection (Freighter API)
- **`animate-scale-in`**: Tailwind animation for modal entrance transitions
- **Comprehensive ScVal conversion**: Contract invoke route supports `address`, `i128`, `symbol`, `vec`, `map`, and `bool` args

### Changed
- **DripPool.claim_reward()**: Now actually transfers reward tokens to users via cross-contract call; deducts from `KEY_REWARD_POOL`
- **DripGovernance.execute()**: Now applies `GovernanceAction` on-chain: `SetActive` calls DripPool, `MintTokens` calls DripToken
- **DripToken.approve()**: Now stores and enforces `expiration_ledger`; expired allowances removed on access
- **DripPool.fund_rewards()**: Now transfers tokens from admin to pool via `transfer_from` cross-contract call
- **ZERO_ADDRESS**: Replaced all 14 hardcoded `GAAA...WHF` strings with `ZERO_ADDRESS_STR` constant across 4 contract files
- **Hardcoded values**: Extracted `DEFAULT_MAX_STAKE` and `REWARD_DIVISOR` as named constants
- **dbService.ts**: Rewrote with in-memory primary store (serverless-compatible); JSON file fallback for local dev
- **network.ts**: Consolidated with `env.ts` as single source of truth for all Stellar network config
- **batch/route.ts + status/route.ts**: Now import `STELLAR_NETWORK` instead of reading `process.env` directly
- **contract/invoke route**: Comprehensive `argToScVal()` supporting 8 ScVal types (was 2)
- **env.ts**: Config logging limited to `development` mode only; reduced information disclosure
- **Tailwind config**: Added `scale-in` keyframes and animation for modal entrance transitions

### Fixed
- **P0: Reward payout**: `claim_reward()` now performs cross-contract token transfer (was phantom rewards)
- **P0: Governance execution**: `execute()` now applies actions via DripPool/DripToken cross-contract calls (was no-op)
- **P0: Allowance expiration**: `approve()` stores and `transfer_from()`/`allowance()` enforce expiration ledger
- **P1: Database persistence**: In-memory store works on Vercel/serverless; JSON file backup for local dev
- **P1: Config consolidation**: Single source of truth via `network.ts` → `env.ts`; removed duplicate defaults
- **P1: ScVal arg handling**: Contract invoke supports Address, i128, Symbol, Vec, Map, Bool (was only string/number)
- **P1: Wallet disconnect**: `checkWalletStillConnected()` detects Freighter disconnection
- **P2: Dead code removal**: Deleted `contractService.ts`, `transactionService.ts`, `balanceService.ts`, `walletService.ts` (unused re-exports)
- **P2: Missing animation**: Added `animate-scale-in` to Tailwind config
- **P2: Config logging**: Restricted to dev mode only

### Removed
- **Dead service layer**: `src/services/{contractService,transactionService,balanceService,walletService}.ts` — pure re-export barrels with zero consumers

---

## [2.1.0] — 2026-08-07

### Added
- **Soroban SDK 27.0.5** upgrade with `wasm32v1-none` build target (Rust 1.84+)
- **`.env.example`** template with all configurable environment variables
- **`walletClient.ts`** module for wallet session registration with backend
- **`next/font`** integration for Inter and JetBrains Mono (replaces CSS @import)
- **Gitleaks secret scanning** in CI with comprehensive allowlist config
- **Gravity Index** support for discovering and integrating third-party services

### Changed
- **Counter contract**: Fixed per-user tracking bug — each user now has independent counter
- **Contract events**: Migrated from deprecated `env.events().publish()` to `#[contractevent]` structs
- **Token contract**: Renamed `initialize` → `initialize_token` for SDK 27 compatibility
- **Badge contract**: Renamed `initialize` → `initialize_badge`, `admin` → `get_admin`
- **Pool contract**: Renamed `initialize` → `initialize_pool`, `get_config` → `get_pool_config`
- **Governance contract**: Renamed `initialize` → `initialize_governance`, `get_config` → `get_gov_config`
- **All tests**: Updated `Address::random` → `Address::generate` for SDK 27 testutils
- **WASM target**: Switched all builds from `wasm32-unknown-unknown` to `wasm32v1-none`
- **Coverage reporter**: Bumped `lcov-reporter-action` from v0.3.1 to v0.4.0
- **Gitleaks config**: Rewritten with proper regex-based allowlist rules

### Fixed
- **CI/CD pipelines**: All 7 failing workflows now pass (contract tests, CodeQL, deploy, coverage, Gitleaks, Docker)
- **WASM build**: SDK 27 requires Rust 1.84+ with `wasm32v1-none` target
- **Secret scanning**: Removed `GITLEAKS_LICENSE` requirement; fixed invalid TOML rules
- **CodeQL**: Added `security-extended` queries and `fail-fast: false` strategy
- **Docker build**: Added permissions block, Buildx setup, and telemetry build args
- **Contract deploy workflow**: Added cargo caching and WASM verification steps
- **README**: Updated Soroban badge (22→27), test counts (110→119), Rust version (1.70→1.84)
- **CSS fonts**: Replaced blocking `@import` with optimized `next/font/google`

### Removed
- **Duplicate code**: Consolidated overlapping Soroban service logic
- **Trailing comments**: Cleaned up legacy comment markers from all Rust contract files
- **Empty placeholder**: Replaced `common/types.rs` with actual shared type definitions

---

## [2.0.0] — 2026-08-06

### Added
- **5 smart contracts**: DripToken (SEP-41), DripPool (staking), DripGovernance, DripBadge, Counter
- **Inter-contract communication**: DripPool↔DripToken, DripGovernance↔DripToken cross-contract calls
- **Hybrid architecture**: Direct browser→Stellar reads, proxied API writes
- **SSE event streaming**: Real-time contract events with polling fallback
- **19 test suites**: 119 frontend tests + 19 Rust contract tests
- **CI/CD pipeline**: 6-stage GitHub Actions (contracts → tests → lint → build → preview → production)
- **API Gateway**: 11 rate-limited API routes with session management
- **Admin dashboard**: Analytics and transaction monitoring at `/admin`
- **Error handling**: ErrorBoundary, AsyncBoundary, Skeleton loading states
- **Multi-wallet support**: Freighter, xBull, Albedo, LOBSTR, WalletConnect
- **Comprehensive documentation**: 23-section README with architecture diagrams and API reference

### Changed
- Refactored counter into multi-contract module architecture
- Migrated balance reads from API proxy to direct Horizon calls
- Upgraded wallet abstraction layer for Stellar Wallets Kit v2

### Fixed
- Removed duplicate `/api/fund` route (canonical is `/api/faucet/fund`)
- Consolidated duplicate type definitions into `stellar.d.ts`
- Fixed stray export in API client barrel file

---

## [1.0.0] — 2026-07-01

### Added
- **Initial release**: Testnet XLM faucet with Stellar Friendbot integration
- **Wallet connection**: Freighter wallet support with connect/sign/disconnect
- **Multi-asset balance**: Horizon balance fetching for XLM + custom assets
- **Send payments**: Build, sign, and submit Stellar transactions
- **Soroban counter contract**: Deploy and interact with on-chain counter + greeting
- **Transaction history**: Session log of faucet, send, and contract operations
- **QR codes**: Wallet address and payment request QR generation
- **Address book**: localStorage-based saved addresses
- **Dark theme UI**: Glassmorphism design with Tailwind CSS
- **Mobile responsive**: Full responsive layout from 320px to 4K

---

[2.2.0]: https://github.com/StellarDripz/StellarDripz/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/StellarDripz/StellarDripz/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/StellarDripz/StellarDripz/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/StellarDripz/StellarDripz/releases/tag/v1.0.0
