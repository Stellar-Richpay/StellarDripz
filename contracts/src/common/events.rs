use crate::common::constants::ZERO_ADDRESS_STR;
use soroban_sdk::{contractevent, symbol_short, Address, Env, String, Symbol};

/// Core event symbols shared across contracts
pub const EVENT_MINT: Symbol = symbol_short!("mint");
pub const EVENT_TRANSFER: Symbol = symbol_short!("transfer");
pub const EVENT_BURN: Symbol = symbol_short!("burn");
pub const EVENT_STAKE: Symbol = symbol_short!("stake");
pub const EVENT_UNSTAKE: Symbol = symbol_short!("unstake");
pub const EVENT_REWARD: Symbol = symbol_short!("reward");
pub const EVENT_VOTE: Symbol = symbol_short!("vote");
pub const EVENT_PROPOSE: Symbol = symbol_short!("propose");
pub const EVENT_BADGE_CLAIM: Symbol = symbol_short!("claim");
pub const EVENT_APPROVE: Symbol = symbol_short!("approve");

/// Contract event for token transfers (mint, burn, transfer).
#[contractevent]
pub struct TokenTransferEvent {
    pub event_type: Symbol,
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

/// Emit a token transfer event using the SDK 27 #[contractevent] pattern.
pub fn emit_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    let zero = &Address::from_string(&String::from_str(env, ZERO_ADDRESS_STR));
    let is_mint = *from == *zero;
    let is_burn = *to == *zero;

    let event_type = if is_mint {
        EVENT_MINT
    } else if is_burn {
        EVENT_BURN
    } else {
        EVENT_TRANSFER
    };

    TokenTransferEvent {
        event_type,
        from: from.clone(),
        to: to.clone(),
        amount,
    }
    .publish(env);
}

/// Publish a generic contract event (deprecated API shim).
///
/// WARNING: Uses the deprecated `env.events().publish()` API.
/// All new contract code MUST use the `#[contractevent]` struct pattern
/// shown in `emit_transfer()`. This shim exists only for backward
/// compatibility with existing contracts that haven't been migrated yet.
///
/// Migration plan: Replace each `publish()` call with a dedicated
/// `#[contractevent]` struct and call `.publish(env)` on it.
#[allow(deprecated)]
pub fn publish(
    env: &Env,
    topics: impl soroban_sdk::Topics,
    data: impl soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
) {
    env.events().publish(topics, data);
}
