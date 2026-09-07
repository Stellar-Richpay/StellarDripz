use soroban_sdk::{Env, IntoVal, Symbol, symbol_short};

// ---- Storage Keys ----

pub const KEY_NAME: Symbol = symbol_short!("NAME");
pub const KEY_SYMBOL: Symbol = symbol_short!("SYMBOL");
pub const KEY_DECIMALS: Symbol = symbol_short!("DECIMALS");
pub const KEY_ADMIN: Symbol = symbol_short!("ADMIN");
pub const KEY_TOTAL_SUPPLY: Symbol = symbol_short!("TOT_SUP");
pub const KEY_BALANCE: Symbol = symbol_short!("BALANCE");


// ---- Storage Helpers ----

/// Get or default for persistent storage
pub fn get_persistent<
    T: soroban_sdk::IntoVal<Env, soroban_sdk::Val> + soroban_sdk::TryFromVal<Env, soroban_sdk::Val>,
>(
    env: &Env,
    key: &Symbol,
    default: T,
) -> T {
    env.storage().persistent().get(key).unwrap_or(default)
}

/// Set persistent storage
pub fn set_persistent<T: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &Symbol,
    value: &T,
) {
    env.storage().persistent().set(key, value);
}

// NOTE: Instance storage helpers and require_admin removed as dead code (C6/C5).
// Each contract handles auth and storage independently. Instance storage
// is available directly via env.storage().instance() when needed.

// ---- TTL Maintenance ----

/// Extend the TTL of a persistent entry to the ledger max if it is below the
/// given threshold (in ledgers remaining). Keeps long-lived state such as
/// balances and proposals from expiring when the contract goes quiet.
pub fn bump_persistent_ttl<K: IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K, threshold: u32) {
    let max = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(key, threshold, max);
}

/// Extend the TTL of the contract instance + code so the contract itself
/// does not expire after long inactivity.
pub fn bump_instance_ttl(env: &Env, threshold: u32) {
    let max = env.storage().max_ttl();
    env.storage().instance().extend_ttl(threshold, max);
}

/// Write a persistent value and keep both the entry and the contract instance
/// alive by extending their TTL to the ledger max when below the threshold.
/// This is the write primitive state-changing contracts should use so that
/// balances and other user data cannot silently expire on a quiet network.
pub fn set_and_extend<K: IntoVal<Env, soroban_sdk::Val>, V: IntoVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &K,
    value: &V,
    threshold: u32,
) {
    env.storage().persistent().set(key, value);
    bump_persistent_ttl(env, key, threshold);
    bump_instance_ttl(env, threshold);
}

