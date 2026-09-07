use crate::common::constants::TTL_REFRESH_THRESHOLD;
use crate::common::storage as s;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, symbol_short, Address, Env, String,
    Symbol,
};

// ---- Contract Errors ----

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CounterError {
    Overflow = 1,
    GreetingTooLong = 2,
}

const GLOBAL_COUNTER: Symbol = symbol_short!("GLOBAL");
const USER_COUNTER: Symbol = symbol_short!("USER_CTR");
const GREETING_KEY: Symbol = symbol_short!("GREETING");

/// Contract version, bumped on breaking changes.
const CONTRACT_VERSION: u32 = 1;

/// Greetings longer than this are rejected to bound storage usage.
const MAX_GREETING_BYTES: u32 = 512;

#[contractevent]
pub struct IncrementEvent {
    pub user: Address,
    pub global_count: u32,
    pub user_count: u32,
}

#[contractevent]
pub struct GreetingEvent {
    pub user: Address,
    pub message: String,
}

#[contract]
pub struct StellarDripzCounter;

#[contractimpl]
impl StellarDripzCounter {
    pub fn increment(env: Env, user: Address) -> u32 {
        user.require_auth();

        let mut global: u32 = env.storage().persistent().get(&GLOBAL_COUNTER).unwrap_or(0);
        global = global.checked_add(1).expect("Counter overflow");
        s::set_and_extend(&env, &GLOBAL_COUNTER, &global, TTL_REFRESH_THRESHOLD);

        // Per-user counter — keyed by user address
        let user_key = (USER_COUNTER, &user);
        let mut user_count: u32 = env.storage().persistent().get(&user_key).unwrap_or(0);
        user_count = user_count.checked_add(1).expect("Counter overflow");
        s::set_and_extend(&env, &user_key, &user_count, TTL_REFRESH_THRESHOLD);

        IncrementEvent {
            user: user.clone(),
            global_count: global,
            user_count,
        }
        .publish(&env);

        global
    }

    pub fn get_global(env: Env) -> u32 {
        env.storage().persistent().get(&GLOBAL_COUNTER).unwrap_or(0)
    }

    pub fn get_user(env: Env, user: Address) -> u32 {
        let user_key = (USER_COUNTER, &user);
        env.storage().persistent().get(&user_key).unwrap_or(0)
    }

    /// Greetings are stored per-user so one user cannot overwrite another's.
    pub fn set_greeting(env: Env, user: Address, message: String) -> Result<(), CounterError> {
        user.require_auth();

        if message.len() > MAX_GREETING_BYTES {
            return Err(CounterError::GreetingTooLong);
        }

        let user_key = (GREETING_KEY, &user);
        s::set_and_extend(&env, &user_key, &message, TTL_REFRESH_THRESHOLD);

        GreetingEvent {
            user: user.clone(),
            message: message.clone(),
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_greeting(env: Env, user: Address) -> String {
        let user_key = (GREETING_KEY, &user);
        env.storage()
            .persistent()
            .get(&user_key)
            .unwrap_or(String::from_str(&env, "Hello from StellarDripz!"))
    }

    /// Clear a user's own counter and greeting.
    pub fn reset(env: Env, user: Address) -> Result<(), CounterError> {
        user.require_auth();

        env.storage().persistent().remove(&(USER_COUNTER, &user));
        env.storage().persistent().remove(&(GREETING_KEY, &user));
        Ok(())
    }

    /// Current contract version.
    pub fn counter_version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }
}
