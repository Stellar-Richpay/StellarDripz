// Shared constants used across all StellarDripz contracts.

/// Stellar zero/burn address string (GAAA...WHF).
/// Used as a sentinel for "no address" and for mint/burn event detection.
pub const ZERO_ADDRESS_STR: &str =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/// Ledgers of TTL remaining below which a write refreshes the entry to the
/// ledger max. ~30 days at ~5s/ledger, far above the network minimum so
/// actively-used data never silently expires, while idle entries eventually
/// do and free rent.
pub const TTL_REFRESH_THRESHOLD: u32 = 500_000;
