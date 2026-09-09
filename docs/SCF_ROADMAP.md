# Stellar Community Fund — Milestone Roadmap

**Project:** StellarDripz  
**Version:** 3.0.0 (Target)  
**Total Request:** $50,000 in XLM (SCF Build Award, Tier 2)  
**Duration:** 4 months (16 weeks)

---

## Overview

StellarDripz is a production-grade Stellar testnet faucet and smart contract platform with 5 Soroban contracts (DripToken, DripPool, DripGovernance, DripBadge, Counter), a Next.js frontend, multi-wallet support, and a comprehensive CI/CD pipeline. This roadmap outlines the path to Mainnet readiness and ecosystem integration.

---

## Tranche #0 — Award Acceptance (10%: $5,000)

**Deliverable:** Formal acceptance and team onboarding.

- [x] Contracts deployed to Stellar Testnet (ledger 4,085,848)
- [x] Comprehensive security audit completed internally
- [x] Documentation and contributor guide published
- [ ] SCF Agreement signed
- [ ] KYC/KYB completed (if required)

---

## Tranche #1 — MVP: Core Contracts + Testnet (20%: $10,000)

**Duration:** Weeks 1–4  
**Deliverable:** Hardened smart contracts with full test coverage and external audit submission.

### Smart Contracts
- [x] ✅ DripToken with `set_minter` authorization (governance integration)
- [x] ✅ DripPool with checked arithmetic and reward calculation
- [x] ✅ DripGovernance with cross-contract proposal execution
- [x] ✅ DripBadge with admin grant and user claim
- [x] ✅ Counter with per-user tracking
- [ ] 🔲 Submit contracts to SCF Audit Bank for external review
- [ ] 🔲 Implement SAC (Stellar Asset Contract) compatibility wrapper for DripToken
- [x] ✅ Add `#[contracterror]` codes to all remaining contracts (Governance, Counter)
- [x] ✅ Migrate legacy `publish()` calls to `#[contractevent]` structs in all contracts

### Frontend
- [x] ✅ Multi-wallet connection (Freighter, xBull, Albedo, LOBSTR, WalletConnect)
- [x] ✅ SSE event streaming with polling fallback
- [x] ✅ Rate-limited API routes with CSRF protection
- [x] ✅ Contract ID input with Stellar checksum validation
- [ ] 🔲 Complete WalletConnect UI messaging for unconfigured project ID
- [ ] 🔲 Add contract interaction wizard (guided flow for mint/transfer/stake/vote)

### Testing
- [x] ✅ 94 Rust contract tests (incl. property-based fuzz tests)
- [x] ✅ 276 TypeScript tests (38 suites)
- [x] ✅ TypeScript strict mode — zero compilation errors
- [ ] 🔲 Achieve >80% code coverage on contracts (add edge case tests)
- [ ] 🔲 Add integration tests against live testnet contracts

### Documentation
- [x] ✅ Architecture diagram and API reference
- [x] ✅ Deployment guide and production checklist
- [x] ✅ SCF roadmap (this document)
- [ ] 🔲 Record 5-minute product demo video

---

## Tranche #2 — Testnet Expansion (30%: $15,000)

**Duration:** Weeks 5–9  
**Deliverable:** Feature-complete testnet dApp with analytics, mainnet config, and GrantFox campaign.

### Features
- [x] ✅ Admin dashboard with real-time analytics (contract calls, faucet usage, active users)
- [ ] 🔲 SEP-0024 hosted deposit/withdrawal integration
- [ ] 🔲 SEP-0041 full compliance (token metadata, allowance, authorized/clawback)
- [ ] 🔲 Staking leaderboard and reward history UI
- [ ] 🔲 Governance proposal creation wizard with template actions
- [ ] 🔲 Badge gallery with tier progression visualization
- [ ] 🔲 Dark/light theme toggle with system preference detection

### Infrastructure
- [ ] 🔲 Redis-based rate limiting (Upstash) for multi-instance Vercel deployments
- [ ] 🔲 Vercel Analytics + Speed Insights integration
- [ ] 🔲 Mainnet configuration (`stellar:mainnet` chain, Horizon, RPC)
- [ ] 🔲 Database migration scripts for production data schema

### Community
- [ ] 🔲 Launch GrantFox campaign with 3 funded bounties ($500 each)
- [ ] 🔲 Publish contributor guide with Drips Wave point values
- [ ] 🔲 Set up GitHub Discussions for community support
- [ ] 🔲 Create Discord/Telegram community channel

---

## Tranche #3 — Mainnet Launch (40%: $20,000)

**Duration:** Weeks 10–16  
**Deliverable:** Audited contracts on Mainnet, public SDK, and ecosystem integrations.

### Mainnet Deployment
- [ ] 🔲 External audit completed and all findings resolved
- [ ] 🔲 Deploy all 5 contracts to Stellar Mainnet
- [ ] 🔲 SAC wrapper for DripToken (Stellar Asset Contract compatibility)
- [ ] 🔲 Mainnet monitoring and alerting (PagerDuty/healthchecks.io)
- [ ] 🔲 Mainnet rate limiting and abuse prevention

### Developer SDK
- [ ] 🔲 `@stellardripz/sdk` npm package (TypeScript)
- [ ] 🔲 `stellardripz-sdk` Rust crate (crates.io)
- [ ] 🔲 CLI tool: `npx stellardripz deploy` / `npx stellardripz interact`
- [ ] 🔲 SDK documentation site (Docusaurus/VitePress)

### Ecosystem Integration
- [ ] 🔲 Stellar Expert verified contract badges
- [ ] 🔲 Soroban dApp Store listing
- [ ] 🔲 Cross-dApp composability demo (DripToken ↔ other Soroban protocols)
- [ ] 🔲 Partnership announcements with Stellar wallets and ecosystem projects

### Growth
- [ ] 🔲 1,000+ unique testnet users
- [ ] 🔲 5+ community contributors
- [ ] 🔲 Featured in Stellar Developer Digest
- [ ] 🔲 Conference presentation (Meridian, Stellar Dev Digest, etc.)

---

## Risk Management

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Audit delays | Medium | High | Submit to SCF Audit Bank early (Tranche 1); engage backup auditor |
| Soroban protocol changes | Low | Medium | Pin SDK versions; CI tests against latest + pinned |
| Wallet SDK breaking changes | Low | Low | Abstract wallet layer; E2E tests catch regressions |
| Community adoption slow | Medium | Medium | GrantFox bounties; active social presence; documentation quality |

---

## Success Metrics

- **Technical:** 100% test pass rate, 0 critical/medium audit findings, <500ms API latency
- **Community:** 5+ contributors, 3+ funded GrantFox bounties, 100+ GitHub stars
- **Usage:** 1,000+ unique testnet wallets, 10,000+ faucet requests, 500+ contract interactions
- **Ecosystem:** Listed on Stellar Expert, Soroban dApp Store, and Stellar Developer Docs

---

*Last updated: September 9, 2026*
