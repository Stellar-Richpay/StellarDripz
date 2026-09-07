# 🚀 StellarDripz

**Production-grade Stellar dApp with advanced Soroban smart contracts**

A full-featured Stellar testnet faucet and smart contract platform built with Next.js, Soroban, and Stellar SDK. Features multi-wallet support, real-time event streaming, on-chain governance, token staking, and achievement badges.

[![CI/CD Pipeline](https://github.com/StellarDripz/StellarDripz/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/StellarDripz/StellarDripz/actions)
[![Docker Build](https://github.com/StellarDripz/StellarDripz/actions/workflows/docker-build.yml/badge.svg)](https://github.com/StellarDripz/StellarDripz/actions/workflows/docker-build.yml)
[![Lint](https://github.com/StellarDripz/StellarDripz/actions/workflows/lint-strict.yml/badge.svg)](https://github.com/StellarDripz/StellarDripz/actions/workflows/lint-strict.yml)
[![E2E Tests](https://github.com/StellarDripz/StellarDripz/actions/workflows/e2e-tests.yml/badge.svg)](https://github.com/StellarDripz/StellarDripz/actions/workflows/e2e-tests.yml)
[![Code Coverage](https://github.com/StellarDripz/StellarDripz/actions/workflows/code-coverage.yml/badge.svg)](https://github.com/StellarDripz/StellarDripz/actions/workflows/code-coverage.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Soroban](https://img.shields.io/badge/Soroban-27-blue)](https://soroban.stellar.org)

---

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Smart Contracts](#-smart-contracts)
- [Quick Start](#-quick-start)
- [Development](#-development)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [CI/CD](#-cicd)
- [API Reference](#-api-reference)
- [Environment Variables](#-environment-variables)
- [Project Structure](#-project-structure)
- [Demo](#-demo)

---

## ✨ Features

### 🎯 Core Functionality
- **Multi-Wallet Faucet** — Request 10,000 testnet XLM with Freighter, xBull, Albedo, LOBSTR, or WalletConnect
- **Send Payments** — Transfer XLM between any Stellar testnet addresses
- **Smart Contract Interaction** — Deploy and interact with Soroban smart contracts
- **Real-time Event Streaming** — Live contract events via SSE with polling fallback
- **Admin Dashboard** — Analytics and transaction monitoring at `/admin`

### 🔐 Advanced Smart Contracts
| Contract | Description | Features |
|----------|-------------|----------|
| **StellarDripzCounter** | Simple counter + greeting | Increment, get_global, set_greeting, get_user |
| **DripToken** | Soroban fungible token (SEP-41 inspired) | Mint (admin + authorized minter), transfer, approve, transfer_from, burn |
| **DripPool** | Staking pool with rewards | Stake, unstake, claim rewards, lock periods, admin controls |
| **DripGovernance** | On-chain governance | Proposals, voting (For/Against/Abstain), execute |
| **DripBadge** | Achievement NFT badges | Create, claim, grant (Bronze → Silver → Gold → Platinum) |

### 🏗️ Production Architecture
- **API Gateway Pattern** — All Stellar ops routed through Next.js API routes
- **Rate Limiting** — Per-IP and per-address rate limiting with configurable windows
- **Event Streaming** — Server-Sent Events (SSE) with automatic polling fallback
- **Health Checks** — `/api/health` endpoint with service status monitoring
- **Error Boundaries** — Graceful error recovery with retry UI
- **Loading Skeletons** — Polished loading states for all async operations
- **Mobile Responsive** — Fully responsive design from 320px to 4K

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    StellarDripz Frontend                  │
│  (Next.js 14 + React 18 + Tailwind + TypeScript)         │
│                                                          │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Wallet   │ │ Faucet   │ │ Payment  │ │ Contract    │ │
│  │ Connect  │ │ Button   │ │ SendForm │ │ SorobanDemo │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬──────┘ │
└───────┼────────────┼────────────┼───────────────┼────────┘
        │            │            │               │
        ▼            ▼            ▼               ▼
┌─────────────────────────────────────────────────────────┐
│                 API Client Layer (src/lib/client/)        │
│  apiClient.ts → walletClient, faucetClient, etc.         │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────┐
│              Next.js API Routes (src/app/api/)            │
│  /wallet/connect  /faucet/fund  /payment/send            │
│  /contract/invoke /balance/:addr /history /analytics     │
│  /events (SSE)    /health  /batch  /status               │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│              Server Services (src/lib/server/)            │
│  sorobanService  horizonService  dbService               │
│  rateLimiter     sessionManager                           │
└──────────┬────────────────────────────┬──────────────────┘
           │                            │
           ▼                            ▼
┌──────────────────┐      ┌──────────────────────────────┐
│  Soroban RPC     │      │  Stellar Horizon              │
│  (Smart Contracts)│      │  (Transactions, Balances)     │
└──────────────────┘      └──────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│             Stellar Network (Testnet/Mainnet)              │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌───────────┐ │
│  │ Counter   │ │ DripToken │ │ DripPool │ │ Governance│ │ │
│  │ Contract  │ │ Contract  │ │ Contract │ │ + Badge   │ │ │
│  └───────────┘ └───────────┘ └──────────┘ └───────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## 🔧 Smart Contracts

### Inter-Contract Communication

The contracts are designed for composability:

```
DripToken ←── DripPool (transfers on stake/unstake)
DripToken ←── DripGovernance (voting power from token balance)
DripPool  ←── DripGovernance (parameter changes via proposals)
DripBadge ←── DripPool (grant badges based on staking milestones)
```

### Contract Deployment

```bash
# 1. Build WASM
npm run contracts:build

# 2. Set deployer secret key
export DEPLOYER_SECRET_KEY="SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# 3. Deploy
npm run contracts:deploy
```

> **Deployment status:** All 5 smart contracts are deployed to Stellar Testnet (2026-08-11).
> Deployer: `GCNIK6CGM3DXD3NJPZBG4Z76NGCU6YNID3TK7OSTKOJXF3ALBVJWESXK`
> Ledger: 4,085,848

**Deployed Contract IDs:**

| Contract | Contract ID | Explorer |
|----------|------------|----------|
| **Counter** | `CCAIIGMOBRZ2P6OHSYABBB35TJDSXBTC2T5IX7KVPXNIQKXGDJ46R2AE` | [View →](https://stellar.expert/explorer/testnet/contract/CCAIIGMOBRZ2P6OHSYABBB35TJDSXBTC2T5IX7KVPXNIQKXGDJ46R2AE) |
| **DripToken** | `CD3YTU3JCBEMNNVISPTLPVYQATDGIRBJPLVJ2MIO3W56O7TYSWDG3GY6` | [View →](https://stellar.expert/explorer/testnet/contract/CD3YTU3JCBEMNNVISPTLPVYQATDGIRBJPLVJ2MIO3W56O7TYSWDG3GY6) |
| **DripPool** | `CCBNJTZ22HDJTQHIINS22FNIK5KRYIW3CPORFAKNCBMWWL7SRJMZIR6X` | [View →](https://stellar.expert/explorer/testnet/contract/CCBNJTZ22HDJTQHIINS22FNIK5KRYIW3CPORFAKNCBMWWL7SRJMZIR6X) |
| **Governance** | `CD3NIJCGVECTGPOUQOWYERWXQMOXJFSX6AKVI4KZVXGO4ZBYO7G6AIVH` | [View →](https://stellar.expert/explorer/testnet/contract/CD3NIJCGVECTGPOUQOWYERWXQMOXJFSX6AKVI4KZVXGO4ZBYO7G6AIVH) |
| **Badge** | `CAZFH3S7JUEI7LZSQGHMM6OF5UKWLNZ3CSOX2KNUX3RBFPP5Q6GEEUWE` | [View →](https://stellar.expert/explorer/testnet/contract/CAZFH3S7JUEI7LZSQGHMM6OF5UKWLNZ3CSOX2KNUX3RBFPP5Q6GEEUWE) |

### Contract Structure
```
contracts/src/
├── lib.rs            # Module registry & re-exports
├── test.rs           # Cross-module integration tests
├── counter/
│   └── mod.rs        # StellarDripzCounter (existing)
├── token/
│   └── mod.rs        # DripToken (SEP-41)
├── pool/
│   └── mod.rs        # DripPool (Staking)
├── governance/
│   └── mod.rs        # DripGovernance
├── badge/
│   └── mod.rs        # DripBadge (NFT)
└── common/
    ├── mod.rs
    ├── storage.rs    # Shared storage helpers
    ├── events.rs     # Common event emitters
    └── types.rs      # Shared types
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Rust 1.84+ with `wasm32v1-none` target
- A Stellar wallet (Freighter recommended)
- Testnet XLM (get from https://friendbot.stellar.org)

### Setup

```bash
# Clone
git clone https://github.com/StellarDripz/StellarDripz.git
cd stellardripz

# Install dependencies
npm install

# Copy env template
cp .env.example .env.local

# Install Rust + wasm target (for contracts)
rustup target add wasm32v1-none

# Build contracts
npm run contracts:build

# Run tests
npm run contracts:test
npm test

# Start dev server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

---

## 🧪 Testing

### Smart Contract Tests

```bash
npm run contracts:test        # cargo test
npm run verify:contracts      # fmt check + clippy (-D warnings) + tests
```

The contracts exercise typed errors, quorum voting, reward accounting,
TTL maintenance, and property-style fuzz invariants (55 tests).

### Frontend Tests

```bash
npm test           # jest (unit + API route tests)
npm run verify     # lint + typecheck + tests + format:check
npm run format     # prettier --write
```

Test suites (29 suites, 180 tests, all passing ✅):
- Wallet/hooks: `useWallet`, `useBalance`, `useTransactionHistory`, `useFaucet`, `walletService`
- API routes: `api-faucet`, `api-wallet`, `api-payment`, `api-balance`, `api-history`, `api-contract`, `api-health`, `api-status`, `api-analytics`, `api-batch`, `api-events`
- Services/lib: `dbService`, `addressBookService`, `directClient`, `rateLimiter`, `apiClient`, `env`, `config`
- Validation: `addressValidation`, `contractTypes`, `paymentValidation`, `networkGuard`
- Integration + rate limiter server suites

Coverage is collected with `npx jest --coverage`; the enforced global gate
(45% branches / 50% functions / 55% lines) mirrors what CI runs inline.

---

## 🚢 Deployment

### Production Build

```bash
npm run build
npm start
```

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/StellarDripz/StellarDripz)

1. Push to GitHub
2. Connect to Vercel
3. Set environment variables (see below)
4. Deploy!

**Production setup checklist (for a fully functional deployment):**

1. **Deploy the smart contracts** — set a funded testnet `DEPLOYER_SECRET_KEY`, run `npm run contracts:deploy`, and copy the printed `NEXT_PUBLIC_CONTRACT_*` IDs.
2. **Configure persistence (recommended)** — create a Supabase project, run [`src/lib/server/supabase-schema.sql`](./src/lib/server/supabase-schema.sql), and set `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Without this, analytics/transaction history fall back to an in-memory store that is **ephemeral on serverless** (data resets on cold start).
3. **Add the variables** below to GitHub (repo Variables/Secrets) — the CI/CD pipeline forwards them to every Vercel deployment.

**Required GitHub Variables** (forwarded to Vercel by the CI/CD pipeline):

```
NEXT_PUBLIC_SOROBAN_RPC_URL
NEXT_PUBLIC_HORIZON_URL
NEXT_PUBLIC_STELLAR_NETWORK
NEXT_PUBLIC_CONTRACT_COUNTER          # after contracts:deploy
NEXT_PUBLIC_CONTRACT_DRIP_TOKEN       # after contracts:deploy
NEXT_PUBLIC_CONTRACT_DRIP_POOL        # after contracts:deploy
NEXT_PUBLIC_CONTRACT_GOVERNANCE       # after contracts:deploy
NEXT_PUBLIC_CONTRACT_BADGE            # after contracts:deploy
NEXT_PUBLIC_SUPABASE_URL              # if using Supabase
```

**Required GitHub Secrets:**

```
SUPABASE_SERVICE_ROLE_KEY             # if using Supabase
```

### Live Deployment

[![Live](https://img.shields.io/badge/Live-stellardripz.vercel.app-000?style=flat-square&logo=vercel&logoColor=white&labelColor=000)](https://stellardripz.vercel.app)

**🔗 Live Demo:** [https://stellardripz.vercel.app](https://stellardripz.vercel.app)  
**🎥 Demo:** See [demo/README.md](./demo/README.md) for the walkthrough script. A recorded demo video is planned for the next release.

### Security Headers

The app ships production security headers via `next.config.js`: CSP (with clickjacking protection via `frame-ancestors 'self'`), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`. No global `Access-Control-Allow-Origin` is set — only `/api/health` exposes CORS (for external monitoring), so cross-origin reads of API data remain blocked.

### Serverless Notes (Vercel)

- **SSE `/api/events`** — Vercel caps function duration (`maxDuration` = 300s is set; Hobby plans may cut streams sooner). The frontend automatically falls back to direct Soroban RPC polling, so event streaming keeps working.
- **Rate limiting** — the in-memory limiter is per-instance. For multi-instance deployments, migrate to a shared store (Upstash/Redis).
- **DB fallback** — the JSON fallback writes to `/tmp` when the project dir is read-only; data is lost on cold start. Configure Supabase for durable storage.

### Manual Deploy

```bash
# Build production bundle
NODE_ENV=production npm run build

# Deploy .next/ to your hosting provider
```

---

## 🔄 CI/CD Pipeline

### GitHub Actions Workflow

The pipeline runs on every push and PR to `main`:

| Job | Trigger | Actions |
|-----|---------|---------|
| 🔧 Contract Tests | Push, PR | `cargo test`, `cargo build --release` |
| 🧪 Frontend Tests | Push, PR | `npm test`, `npx tsc --noEmit` |
| 📋 Lint | Push, PR | `npm run lint` |
| 🏗️ Build | Push, PR | `npm run build` |
| 🚀 Deploy Preview | PR | Vercel preview deployment |
| 🌐 Deploy Production | Push to main | Vercel production |

### Required Secrets

```
VERCEL_TOKEN        — Vercel API token
VERCEL_ORG_ID       — Vercel organization ID
VERCEL_PROJECT_ID   — Vercel project ID
```

### Required Variables

```
NEXT_PUBLIC_SOROBAN_RPC_URL
NEXT_PUBLIC_HORIZON_URL
NEXT_PUBLIC_STELLAR_NETWORK
NEXT_PUBLIC_CONTRACT_COUNTER
NEXT_PUBLIC_CONTRACT_DRIP_TOKEN
NEXT_PUBLIC_CONTRACT_DRIP_POOL
NEXT_PUBLIC_CONTRACT_GOVERNANCE
NEXT_PUBLIC_CONTRACT_BADGE
NEXT_PUBLIC_SUPABASE_URL
```

### Required Secrets

```
SUPABASE_SERVICE_ROLE_KEY
```

---

## 📡 API Reference

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/health` | Service health status + uptime | None |
| `GET` | `/api/events?contractId=X` | SSE event stream | None |
| `POST` | `/api/wallet/connect` | Register wallet session | None |
| `GET` | `/api/balance/:address` | Fetch account balance | None |
| `POST` | `/api/faucet/fund` | Request testnet XLM | Rate-limited |
| `POST` | `/api/payment/send` | Build or submit payment | Rate-limited |
| `POST` | `/api/contract/invoke` | Simulate, build, or submit contract call | Rate-limited |
| `GET` | `/api/history` | Transaction history | None |
| `GET` | `/api/analytics` | Usage analytics | None |
| `POST` | `/api/batch` | Batch operations | Rate-limited |
| `GET` | `/api/status` | Network status check | None |

---

## 🔒 Environment Variables

See `.env.example` for the full list. Copy to `.env.local` for local development.

**Required:**
- `NEXT_PUBLIC_SOROBAN_RPC_URL` — Soroban RPC endpoint
- `NEXT_PUBLIC_HORIZON_URL` — Horizon API endpoint

**Optional (for contract features):**
- `NEXT_PUBLIC_CONTRACT_COUNTER` — Deployed Counter contract ID
- `NEXT_PUBLIC_CONTRACT_DRIP_TOKEN` — Deployed DripToken contract ID
- `NEXT_PUBLIC_CONTRACT_DRIP_POOL` — Deployed DripPool contract ID
- `NEXT_PUBLIC_CONTRACT_GOVERNANCE` — Deployed Governance contract ID
- `NEXT_PUBLIC_CONTRACT_BADGE` — Deployed Badge contract ID

**Deployer:**
- `DEPLOYER_SECRET_KEY` — Secret key for contract deployment

---

## 📁 Project Structure

```
stellardripz/
├── .github/workflows/
│   └── ci-cd.yml              # CI/CD pipeline
├── contracts/                  # Soroban smart contracts (Rust)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── test.rs
│       ├── counter/mod.rs
│       ├── token/mod.rs
│       ├── pool/mod.rs
│       ├── governance/mod.rs
│       ├── badge/mod.rs
│       └── common/
├── scripts/
│   ├── deploy-contract.ts      # Contract deployment
│   └── build-contracts.sh      # Build script
├── src/
│   ├── app/
│   │   ├── page.tsx            # Main page
│   │   ├── layout.tsx          # Root layout + ErrorBoundary
│   │   ├── admin/page.tsx      # Admin dashboard
│   │   └── api/                # API routes (10 endpoints)
│   ├── components/             # React components (15+)
│   ├── context/AppContext.tsx   # Global state manager
│   ├── hooks/                  # Custom hooks
│   ├── lib/
│   │   ├── client/             # Frontend API clients
│   │   ├── server/             # Backend services
│   │   ├── stellar/            # Stellar integration
│   │   ├── wallets/            # Wallet connector
│   │   ├── db.ts               # Database abstraction
│   │   ├── rateLimiter.ts      # Client rate limiter
│   │   ├── logger.ts           # Structured logger
│   │   └── env.ts              # Config validation
│   ├── services/               # Re-exported service layer
│   ├── types/index.ts          # TypeScript types
│   └── __tests__/              # Test suites (7)
├── .env.example
├── Makefile
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── jest.config.js
├── postcss.config.js
└── README.md
```

---

## 📱 Mobile Responsive

The UI is fully responsive with these breakpoints:

| Width | Layout | Changes |
|-------|--------|---------|
| **< 768px** | Single column | Stacked cards, full-width inputs, hamburger navigation |
| **768-1024px** | Two column grid | Balance/Faucet left, Send/History right |
| **> 1024px** | Max-width 5XL | Centered content, extended contract demos |

All components use relative units, flexbox/grid, and Tailwind responsive classes.

---

## 🎥 Demo Video Script (2-3 minutes)

1. **Introduction (0:00-0:20)**
   - Show project README and architecture diagram
   - Explain StellarDripz purpose

2. **Wallet Connection & Faucet (0:20-0:50)**
   - Connect Freighter wallet
   - Click faucet to receive 10,000 testnet XLM
   - Show balance update

3. **Send Payment (0:50-1:15)**
   - Send XLM to another address
   - Show transaction confirmation
   - Transaction history update

4. **Smart Contract Demo (1:15-2:00)**
   - Paste deployed contract ID
   - Read counter value
   - Increment counter (wallet signing)
   - Set greeting message
   - Show real-time event stream

5. **Advanced Contracts (2:00-2:30)**
   - Show DripToken mint/transfer
   - Show DripPool staking
   - Show governance voting
   - Show badge claims

6. **CI/CD & Testing (2:30-3:00)**
   - Show GitHub Actions pipeline running
   - Show test output (55 contract + 180 frontend tests passing)
   - Show Vercel deployment
   - Admin dashboard analytics

---

## 📊 Screenshots

### CI/CD Pipeline Running
![CI/CD Pipeline](./screenshots/cicd-pipeline.png)
*GitHub Actions workflow — contract tests, frontend tests, lint, build, and Vercel deploy all passing.*

### Test Output — All 180 Tests Passing
![Test Output](./screenshots/test-output.png)
*29 test suites, 180 tests passing with zero failures. TypeScript strict mode compiles cleanly.*

### Mobile Responsive UI
![Mobile UI](./screenshots/mobile-responsive.png)
*Fully responsive layout from 320px to 4K — stacked cards on mobile, two-column on tablet, max-width 5XL on desktop.*

### Contract Deployment
![Contract Deployment](./screenshots/contract-deployment.png)
*Five smart contracts deployed to Stellar Testnet: Counter, DripToken, DripPool, DripGovernance, DripBadge.*

### Multi-Wallet Connect
![Wallet Connect](./screenshots/wallet-connect.png)
*Multi-wallet picker supporting Freighter, xBull, Albedo, LOBSTR, and WalletConnect.*

### Soroban Smart Contract Demo
![Soroban Demo](./screenshots/soroban-demo.png)
*Direct contract reads via Soroban RPC, proxied writes through API with real-time event streaming.*

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Convention
We use [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation
- `test:` — Tests
- `refactor:` — Code restructuring
- `ci:` — CI/CD changes
- `chore:` — Maintenance

---

## 📄 License

MIT © StellarDripz

---

## 👥 Credits

Built with:
- [Next.js](https://nextjs.org)
- [React](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [Stellar SDK](https://stellar.org/sdk)
- [Soroban SDK](https://soroban.stellar.org)
- [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit)

## 🔌 Hook API Reference

### useWallet
```tsx
const { wallet, connecting, error, connect, disconnect, refreshWallets } = useWallet();
```
Manages wallet connection state with auto-reconnection from persisted sessions.

### useBalance
```tsx
const { balance, loading, error, refresh } = useBalance({ address, refreshInterval: 30000 });
```
Fetches Stellar account balances with optional auto-refresh polling.

### useTransactionHistory
```tsx
const { transactions, loading, error, total, refresh } = useTransactionHistory({ address, type: "faucet" });
```
Retrieves filtered transaction history with auto-refresh support.

### useFaucet
```tsx
const { requesting, success, error, lastHash, canRequest, request, cooldownRemaining } = useFaucet({ address });
```
Requests testnet XLM with built-in cooldown timer to prevent spamming.

### useContractEvents
```tsx
const { events, connected, error, clearEvents } = useContractEvents({ contractId, pollInterval: 5000 });
```
Subscribes to real-time Soroban contract events via SSE with automatic polling fallback.

## 📊 Test Coverage

| Category | Suites | Tests |
|----------|--------|-------|
| Services | 6 | 35+ |
| Hooks | 5 | 30+ |
| API Routes | 11 | 60+ |
| Validation & other | 7 | 55+ |
| **Total** | **29** | **180** |

All 180 tests pass with zero failures. TypeScript strict mode compiles cleanly.

### Running Tests

\`\`\`bash
# Run all tests
npm test

# Run specific test suite
npx jest src/__tests__/api-faucet.test.ts

# Run tests in watch mode
npm run test:watch

# TypeScript type check
npm run typecheck
\`\`\`

## 🔀 Hybrid Architecture

StellarDripz uses a **hybrid direct/proxied architecture**:

### Direct Reads (Browser → Stellar)
For low-latency queries, the browser talks directly to Horizon and Soroban RPC:
- **Balance fetching** (`directFetchBalance`) — direct Horizon `loadAccount`
- **Contract simulation** (`directSimulateContract`) — direct Soroban `simulateTransaction`
- **Event polling** (`directFetchContractEvents`) — direct Soroban `getEvents`
- **Latest ledger** (`directGetLatestLedger`) — direct Soroban `getLatestLedger`

### Proxied Writes (Browser → API → Stellar)
For rate-limited, logged, and validated operations:
- **Faucet funding** — `/api/faucet/fund` with per-address cooldown
- **Payment sending** — `/api/payment/send` with build/sign/submit flow
- **Contract invocation** — `/api/contract/invoke` with fee estimation
- **Event streaming (SSE)** — `/api/events` server-side event proxy
- **Transaction history** — `/api/history` from server database
- **Analytics** — `/api/analytics` from server database

```
┌──────────────────────────────────────────┐
│              Browser                      │
│  ┌──────────┐  ┌──────────────────────┐  │
│  │  Reads   │──│  Horizon / Soroban   │  │
│  │ (direct) │  │  (direct connection) │  │
│  └──────────┘  └──────────────────────┘  │
│  ┌──────────┐  ┌────────┐  ┌──────────┐ │
│  │  Writes  │──│  API   │──│  Stellar │ │
│  │ (proxied)│  │ Routes │  │  Network │ │
│  └──────────┘  └────────┘  └──────────┘ │
└──────────────────────────────────────────┘
```

## 📐 Architecture Decision: Hybrid Reads/Writes

**Decision:** The browser talks directly to Stellar Horizon/Soroban RPC for read operations but routes writes through the Next.js API proxy.

**Rationale:**
- Reads are idempotent and latency-sensitive — direct connection eliminates a round-trip
- Writes need rate limiting, logging, and validation — proxying ensures consistent enforcement
- Horizon and Soroban RPC both allow CORS from browser contexts
- The API proxy remains the single source of truth for analytics and transaction history

**Trade-off:** Direct reads forgo server-side logging of balance queries, but the latency improvement (50-100ms) outweighs this for a testnet faucet.



