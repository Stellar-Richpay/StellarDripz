use crate::common::constants::ZERO_ADDRESS_STR;
use soroban_sdk::{contractevent, symbol_short, Address, Env, String, Symbol};

// (The deprecated `env.events().publish()` shim that lived here was removed
// in the SDK-27 events migration — every contract now emits via typed
// `#[contractevent]` structs.)

/// Core event symbols shared across contracts. Per-contract events (stake,
/// unstake, reward, vote, propose, claim, approve, …) now live as the topic
/// prefixes on each contract's `#[contractevent]` structs; only the token
/// transfer events remain shared here.
pub const EVENT_MINT: Symbol = symbol_short!("mint");
pub const EVENT_TRANSFER: Symbol = symbol_short!("transfer");
pub const EVENT_BURN: Symbol = symbol_short!("burn");

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
