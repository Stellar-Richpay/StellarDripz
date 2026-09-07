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

mod common;
pub mod counter;
pub mod token;
pub mod pool;
pub mod governance;
pub mod badge;

// Re-export all contract types for external use
pub use counter::StellarDripzCounter;
pub use token::DripToken;
pub use pool::DripPool;
pub use governance::DripGovernance;
pub use badge::DripBadge;

#[cfg(test)]
mod test;

#[cfg(test)]
mod fuzz_tests;


