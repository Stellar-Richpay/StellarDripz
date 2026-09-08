# StellarDripz — Technical Whitepaper v1.0

**August 2026** | **Version 2.3.0**

---

## Abstract

StellarDripz is a production-grade decentralized application (dApp) built on the Stellar
Soroban smart contract platform. It provides a multi-wallet testnet faucet, token staking
pools, on-chain governance, and achievement badges — all powered by 5 composable Soroban
contracts. The platform demonstrates a complete Soroban dApp architecture: cross-contract
communication, event streaming, rate-limited API gateway, and multi-wallet support.

---

## 1. Introduction

### 1.1 Problem Statement

Developers building on Stellar Soroban face multiple friction points:
- **Testnet XLM acquisition** requires navigating Friendbot manually
- **Smart contract interaction** lacks user-friendly interfaces
- **Governance and staking** require custom contract development
- **Cross-contract patterns** are undocumented and error-prone

### 1.2 Solution

StellarDripz provides an integrated platform addressing all four problems:
1. **Faucet**: Rate-limited, multi-wallet testnet XLM distribution
2. **Contracts**: 5 composable Soroban contracts with cross-contract communication
3. **UI**: Polished Next.js frontend with SSE event streaming
4. **Governance**: Token-weighted voting with on-chain execution

---

## 2. Architecture

### 2.1 Smart Contracts

| Contract | Purpose | Lines | Tests |
|----------|---------|-------|-------|
| DripToken | Fungible token with minter delegation | 230 | 20 |
| DripPool | Staking with time-weighted rewards | 210 | 16 |
| DripGovernance | Token-weighted proposal voting | 260 | 16 |
| DripBadge | Achievement NFT badges | 170 | 12 |
| Counter | Simple increment + greeting | 60 | 8 |

### 2.2 Cross-Contract Communication

```
DripToken ← DripPool (stake/unstake via transfer_from)
DripToken ← DripGovernance (voting power from balance)
DripPool  ← DripGovernance (parameter changes via proposals)
DripBadge ← DripPool (staking milestones trigger badge grants)
```

### 2.3 Frontend Architecture

- **Next.js 14** with React 18, TypeScript strict mode
- **API Gateway pattern**: Direct browser→Horizon reads, proxied API writes
- **SSE event streaming** with automatic Soroban RPC polling fallback
- **Multi-wallet**: Freighter, xBull, Albedo, LOBSTR, WalletConnect
- **Security**: CSP, CSRF, rate limiting, CORS policy

---

## 3. Token Economics

### 3.1 DripToken (DRIP)

- **Decimals**: 7
- **Supply**: Admin-controlled minting with minter delegation
- **Use cases**: Staking rewards, governance voting power, achievement gating

### 3.2 Staking Pool

- **Reward formula**: `(staked_amount × reward_rate × elapsed_ledgers) / 10,000,000`
- **Lock period**: Configurable (default 100 ledgers ≈ 8 minutes)
- **Min/Max stake**: Configurable by governance
- **Reward pool**: Funded by admin, capped at available balance

### 3.3 Governance

- **Proposal creation**: Requires minimum token balance (configurable)
- **Voting**: Token-weighted, For/Against/Abstain
- **Execution**: Automatic cross-contract calls on passage
- **Actions**: SetRewardRate, SetMinStake, SetLockPeriod, SetActive, MintTokens

---

## 4. Security

### 4.1 Contract Security

- ✅ Checked arithmetic (`checked_add`, `checked_sub`) on all operations
- ✅ `#[contracterror]` enums for machine-parseable errors
- ✅ Auth on all write operations (`require_auth`)
- ✅ Admin-only functions with address verification
- ⏳ External audit (planned via SCF Audit Bank)

### 4.2 Application Security

- CSRF protection on all state-changing endpoints
- CSP with clickjacking protection (`frame-ancestors 'self'`)
- Rate limiting per-address and per-IP
- Address validation with Stellar checksum verification
- Contract ID checksum validation

---

## 5. Roadmap

See [SCF_ROADMAP.md](./SCF_ROADMAP.md) for the complete 4-tranche plan.

| Tranche | Focus | Budget |
|---------|-------|--------|
| #0 | Award Acceptance | $5,000 |
| #1 | MVP: Core Contracts + Testnet | $10,000 |
| #2 | Testnet Expansion + Community | $15,000 |
| #3 | Mainnet Launch + SDK | $20,000 |

---

## 6. Team & Community

- **GitHub**: https://github.com/StellarDripz/StellarDripz
- **Live Demo**: https://stellardripz.vercel.app
- **Contract Explorer**: [Stellar Expert](https://stellar.expert/explorer/testnet)
- **Security**: security@stellardripz.dev

---

## References

1. [Stellar Soroban SDK Documentation](https://soroban.stellar.org)
2. [SEP-0041: Token Interface](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
3. [Stellar Community Fund](https://communityfund.stellar.org)
4. [Architecture Decision Records](./ADRs.md)
