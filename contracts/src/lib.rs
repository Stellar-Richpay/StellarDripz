#![cfg_attr(not(test), no_std)]

// StellarDripz Smart Contracts — Multi-contract dApp
//
// Modules:
//   - Counter:   Simple counter + greeting (existing)
//   - Token:     DripToken — SEP-41 compatible fungible token
//   - Pool:      DripPool — Staking pool with rewards
//   - Governance: DripGovernance — On-chain proposals & voting
//   - Badge:     DripBadge — Achievement NFT badges
//   - Common:     Shared storage, types, and events

pub mod badge;
mod common;
pub mod counter;
pub mod governance;
pub mod pool;
pub mod token;

// Re-export all contract types for external use
pub use badge::DripBadge;
pub use counter::StellarDripzCounter;
pub use governance::DripGovernance;
pub use pool::DripPool;
pub use token::DripToken;

#[cfg(test)]
mod test;

#[cfg(test)]
mod fuzz_tests;
