use crate::common::constants::{TTL_REFRESH_THRESHOLD, ZERO_ADDRESS_STR};
use crate::common::events as e;
use crate::common::storage as s;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, Address, Env,
    String, Symbol,
};

// ---- Data Types ----

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenMetadata {
    pub name: String,
    pub symbol: String,
    pub decimals: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

/// Per-address authorization state, matching the Stellar Asset Contract's
/// model. An address with no stored entry reads as `Authorized`, so enabling
/// SAC-style controls never changes behavior for addresses that were never
/// touched by an admin.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthorizationState {
    Authorized,
    Unauthorized,
    Clawbackable,
}

// ---- Contract Errors ----
//
// The variant names mirror the Stellar Asset Contract's error vocabulary
// where a direct mapping exists (UnAuthorized / ClawbackNotEnabled), so
// off-chain tooling that understands SAC errors can map ours 1:1:
//   InsufficientBalance   ~ SAC BalanceError
//   InsufficientAllowance ~ SAC AllowanceError
//   NotAuthorized         ~ SAC UnAuthorizedError (admin checks)
//   UnAuthorized          ~ SAC UnAuthorizedError (frozen addresses)
//   ClawbackNotEnabled    ~ SAC ClawbackNotEnabledError

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    InsufficientBalance = 3,
    InsufficientAllowance = 4,
    AllowanceExpired = 5,
    AmountNotPositive = 6,
    ExpirationInPast = 7,
    InvalidRecipient = 8,
    SpenderEqualsOwner = 9,
    InvalidDecimals = 10,
    InvalidMetadata = 11,
    /// Address is frozen (SAC `set_authorized` with authorize=false).
    UnAuthorized = 12,
    /// Clawback attempted while clawback is disabled.
    ClawbackNotEnabled = 13,
    /// Admin role transfer to the zero/burn address (would brick the token).
    InvalidAdmin = 14,
}

// ---- Contract Events (SDK 27 pattern) ----

/// Emitted whenever the authorized minter is set or revoked.
#[contractevent]
pub struct MinterChangedEvent {
    pub admin: Address,
    pub minter: Address,
    pub authorized: bool,
}

/// Emitted on token initialization.
#[contractevent]
pub struct TokenInitializedEvent {
    pub admin: Address,
    pub name: String,
    pub symbol: String,
    pub decimals: u32,
}

/// Emitted on approve (or allowance revocation to zero). Topics are the
/// approve symbol, the owner, and the spender; data is the approved amount.
#[contractevent(topics = ["approve"])]
pub struct ApprovalEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
}

/// Emitted when the admin claws back tokens (SAC `clawback`). Topic is the
/// clawback symbol plus the clawed-back address; data is the amount moved
/// to the admin.
#[contractevent(topics = ["clawback"])]
pub struct ClawbackEvent {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

/// Emitted when clawback is enabled or disabled.
#[contractevent(topics = ["set_clawback_enabled"])]
pub struct ClawbackEnabledEvent {
    pub enabled: bool,
}

/// Emitted when the admin role is transferred to a new address (SAC
/// `set_admin`).
#[contractevent(topics = ["set_admin"])]
pub struct SetAdminEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}

// ---- Storage Keys ----

const KEY_ALLOWANCES: Symbol = symbol_short!("ALLOW_M");
const KEY_MINTER: Symbol = symbol_short!("MINTER");
/// Per-address authorization state, stored as `(KEY_AUTH_STATE, &address)`.
/// Missing entries read as `Authorized` (SAC default).
const KEY_AUTH_STATE: Symbol = symbol_short!("AUTH_ST");
/// Whether clawback is enabled. Defaults to false (SAC default).
const KEY_CLAWBACK_ENABLED: Symbol = symbol_short!("CLAWBACK");

/// SEP-41: decimals must be between 0 and 18.
const MAX_DECIMALS: u32 = 18;
/// SEP-41: symbols are typically 1-12 alphanumeric characters.
const MAX_SYMBOL_BYTES: u32 = 12;
/// Reasonable upper bound on the display name.
const MAX_NAME_BYTES: u32 = 64;

#[contract]
pub struct DripToken;

// ---- Implementation ----

#[contractimpl]
impl DripToken {
    /// Initialize the token with name, symbol, and decimals.
    /// Can only be called once.
    pub fn initialize_token(
        env: Env,
        admin: Address,
        name: String,
        symbol: String,
        decimals: u32,
    ) -> Result<(), TokenError> {
        if env.storage().persistent().has(&s::KEY_ADMIN) {
            return Err(TokenError::AlreadyInitialized);
        }
        if decimals > MAX_DECIMALS {
            return Err(TokenError::InvalidDecimals);
        }
        if name.is_empty() || symbol.is_empty() {
            return Err(TokenError::InvalidMetadata);
        }
        if name.len() > MAX_NAME_BYTES || symbol.len() > MAX_SYMBOL_BYTES {
            return Err(TokenError::InvalidMetadata);
        }

        admin.require_auth();

        s::set_persistent(&env, &s::KEY_ADMIN, &admin);
        s::set_persistent(&env, &s::KEY_NAME, &name);
        s::set_persistent(&env, &s::KEY_SYMBOL, &symbol);
        s::set_persistent(&env, &s::KEY_DECIMALS, &decimals);
        s::set_and_extend(&env, &s::KEY_TOTAL_SUPPLY, &0i128, TTL_REFRESH_THRESHOLD);

        TokenInitializedEvent {
            admin: admin.clone(),
            name: name.clone(),
            symbol: symbol.clone(),
            decimals,
        }
        .publish(&env);

        Ok(())
    }

    /// Authorize or revoke a minter. Only the token admin can call this.
    /// Authorized minters (e.g., governance contract) can mint tokens on behalf
    /// of the admin.
    pub fn set_minter(
        env: Env,
        admin: Address,
        minter: Address,
        authorized: bool,
    ) -> Result<(), TokenError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(TokenError::NotAuthorized);
        }
        admin.require_auth();

        if authorized {
            s::set_and_extend(&env, &KEY_MINTER, &minter, TTL_REFRESH_THRESHOLD);
        } else {
            env.storage().persistent().remove(&KEY_MINTER);
        }

        MinterChangedEvent {
            admin: admin.clone(),
            minter: minter.clone(),
            authorized,
        }
        .publish(&env);

        Ok(())
    }

    /// Check if an address is authorized to mint.
    fn is_minter(env: &Env, addr: &Address) -> bool {
        let stored_minter: Option<Address> = env.storage().persistent().get(&KEY_MINTER);
        match stored_minter {
            Some(m) => m == *addr,
            None => false,
        }
    }

    /// Mint tokens to a recipient. Only admin or authorized minter.
    pub fn mint(env: Env, admin: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        let caller_is_admin = admin == stored_admin;
        let caller_is_minter = Self::is_minter(&env, &admin);

        if !caller_is_admin && !caller_is_minter {
            return Err(TokenError::NotAuthorized);
        }
        admin.require_auth();

        if amount <= 0 {
            return Err(TokenError::AmountNotPositive);
        }
        if Self::is_zero_address(&env, &to) {
            // Minting straight to the burn address permanently inflates the
            // supply with tokens nobody can ever move — reject it.
            return Err(TokenError::InvalidRecipient);
        }
        if !Self::check_auth(&env, &to) {
            // SAC semantics: a frozen address cannot receive freshly minted
            // tokens (it would also be unable to ever move them).
            return Err(TokenError::UnAuthorized);
        }

        let balance_key = (s::KEY_BALANCE, &to);
        let current: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        let new_balance = current.checked_add(amount).expect("Balance overflow");
        s::set_and_extend(&env, &balance_key, &new_balance, TTL_REFRESH_THRESHOLD);

        let current_total: i128 = s::get_persistent(&env, &s::KEY_TOTAL_SUPPLY, 0i128);
        let new_total = current_total
            .checked_add(amount)
            .expect("Total supply overflow");
        s::set_and_extend(
            &env,
            &s::KEY_TOTAL_SUPPLY,
            &new_total,
            TTL_REFRESH_THRESHOLD,
        );

        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR));
        e::emit_transfer(&env, &zero, &to, amount);
        Ok(())
    }

    /// Transfer tokens from caller to recipient. Uses checked arithmetic.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();

        if amount <= 0 {
            return Err(TokenError::AmountNotPositive);
        }

        // Transfers to the zero/burn address would destroy tokens without
        // updating total supply — reject rather than silently burning.
        if Self::is_zero_address(&env, &to) {
            return Err(TokenError::InvalidRecipient);
        }

        // SAC semantics: neither side of a transfer may be frozen. Missing
        // auth entries default to Authorized, so this only bites addresses
        // an admin explicitly froze.
        if !Self::check_auth(&env, &from) || !Self::check_auth(&env, &to) {
            return Err(TokenError::UnAuthorized);
        }

        let from_key = (s::KEY_BALANCE, &from);
        let from_current: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);

        if from_current < amount {
            return Err(TokenError::InsufficientBalance);
        }
        let new_from = from_current.checked_sub(amount).expect("Balance underflow");
        s::set_and_extend(&env, &from_key, &new_from, TTL_REFRESH_THRESHOLD);

        let to_key = (s::KEY_BALANCE, &to);
        let to_current: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        let new_to = to_current
            .checked_add(amount)
            .expect("Recipient balance overflow");
        s::set_and_extend(&env, &to_key, &new_to, TTL_REFRESH_THRESHOLD);

        e::emit_transfer(&env, &from, &to, amount);
        Ok(())
    }

    /// Transfer tokens using an allowance (spend on behalf of owner).
    /// Uses checked arithmetic throughout.
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        spender.require_auth();

        if amount <= 0 {
            return Err(TokenError::AmountNotPositive);
        }
        if Self::is_zero_address(&env, &to) {
            return Err(TokenError::InvalidRecipient);
        }
        if !Self::check_auth(&env, &from) || !Self::check_auth(&env, &to) {
            return Err(TokenError::UnAuthorized);
        }

        let allowance_key = (KEY_ALLOWANCES, &from.clone(), &spender.clone());
        let allowance_val: AllowanceValue = env
            .storage()
            .persistent()
            .get(&allowance_key)
            .unwrap_or(AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            });

        let current_ledger = env.ledger().sequence();
        if allowance_val.expiration_ledger > 0 && current_ledger > allowance_val.expiration_ledger {
            // Do not attempt to remove the stale entry here: this invocation
            // fails with AllowanceExpired, and a failed Soroban call rolls
            // back every storage write — the remove would be reverted anyway.
            // Readers already treat an expired entry as a zero allowance.
            return Err(TokenError::AllowanceExpired);
        }

        if allowance_val.amount < amount {
            return Err(TokenError::InsufficientAllowance);
        }

        let new_allowance = allowance_val
            .amount
            .checked_sub(amount)
            .expect("Allowance underflow");
        if new_allowance == 0 {
            env.storage().persistent().remove(&allowance_key);
        } else {
            let updated = AllowanceValue {
                amount: new_allowance,
                expiration_ledger: allowance_val.expiration_ledger,
            };
            s::set_and_extend(&env, &allowance_key, &updated, TTL_REFRESH_THRESHOLD);
        }

        let from_key = (s::KEY_BALANCE, &from);
        let from_current: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_current < amount {
            return Err(TokenError::InsufficientBalance);
        }
        let new_from = from_current.checked_sub(amount).expect("Balance underflow");
        s::set_and_extend(&env, &from_key, &new_from, TTL_REFRESH_THRESHOLD);

        let to_key = (s::KEY_BALANCE, &to);
        let to_current: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        let new_to = to_current
            .checked_add(amount)
            .expect("Recipient balance overflow");
        s::set_and_extend(&env, &to_key, &new_to, TTL_REFRESH_THRESHOLD);

        e::emit_transfer(&env, &from, &to, amount);
        Ok(())
    }

    /// Approve a spender to use tokens on behalf of the owner.
    /// The allowance expires after `expiration_ledger` (current ledger + desired duration).
    pub fn approve(
        env: Env,
        owner: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) -> Result<(), TokenError> {
        owner.require_auth();

        if owner == spender {
            return Err(TokenError::SpenderEqualsOwner);
        }
        if amount < 0 {
            return Err(TokenError::AmountNotPositive);
        }

        let current_ledger = env.ledger().sequence();
        let key = (KEY_ALLOWANCES, &owner, &spender);
        if amount == 0 {
            // Revoking an allowance should delete the record, not persist a
            // zero-value entry that keeps paying rent and stays in storage
            // forever. Reads already treat a missing key as 0, so removal is
            // semantically identical to a zero allowance — without the dead
            // storage. Revocation is timeless: a user clearing an old,
            // possibly already-expired allowance must not need to invent a
            // future expiration ledger for the revoke to be accepted.
            env.storage().persistent().remove(&key);
        } else {
            if expiration_ledger <= current_ledger {
                return Err(TokenError::ExpirationInPast);
            }
            let allowance = AllowanceValue {
                amount,
                expiration_ledger,
            };
            s::set_and_extend(&env, &key, &allowance, TTL_REFRESH_THRESHOLD);
        }

        ApprovalEvent {
            owner: owner.clone(),
            spender: spender.clone(),
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Burn tokens from the caller's balance. Uses checked arithmetic.
    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();

        if amount <= 0 {
            return Err(TokenError::AmountNotPositive);
        }
        // SAC semantics: a frozen address cannot burn (it cannot move its
        // tokens in any direction, including out of existence).
        if !Self::check_auth(&env, &from) {
            return Err(TokenError::UnAuthorized);
        }

        let key = (s::KEY_BALANCE, &from);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if current < amount {
            return Err(TokenError::InsufficientBalance);
        }
        let new_balance = current.checked_sub(amount).expect("Balance underflow");
        s::set_and_extend(&env, &key, &new_balance, TTL_REFRESH_THRESHOLD);

        let total: i128 = s::get_persistent(&env, &s::KEY_TOTAL_SUPPLY, 0i128);
        let new_total = total.checked_sub(amount).expect("Total supply underflow");
        s::set_and_extend(
            &env,
            &s::KEY_TOTAL_SUPPLY,
            &new_total,
            TTL_REFRESH_THRESHOLD,
        );

        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR));
        e::emit_transfer(&env, &from, &zero, amount);
        Ok(())
    }

    /// Burn `amount` from `from`, consuming the allowance that `spender` has
    /// on `from` (SAC `burn_from`). Mirrors transfer_from's allowance
    /// handling; the burned amount is removed from the total supply.
    pub fn burn_from(
        env: Env,
        spender: Address,
        from: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        spender.require_auth();

        if amount <= 0 {
            return Err(TokenError::AmountNotPositive);
        }
        if !Self::check_auth(&env, &from) {
            return Err(TokenError::UnAuthorized);
        }

        let allowance_key = (KEY_ALLOWANCES, &from.clone(), &spender.clone());
        let allowance_val: AllowanceValue = env
            .storage()
            .persistent()
            .get(&allowance_key)
            .unwrap_or(AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            });

        let current_ledger = env.ledger().sequence();
        if allowance_val.expiration_ledger > 0 && current_ledger > allowance_val.expiration_ledger {
            return Err(TokenError::AllowanceExpired);
        }
        if allowance_val.amount < amount {
            return Err(TokenError::InsufficientAllowance);
        }

        let new_allowance = allowance_val
            .amount
            .checked_sub(amount)
            .expect("Allowance underflow");
        if new_allowance == 0 {
            env.storage().persistent().remove(&allowance_key);
        } else {
            let updated = AllowanceValue {
                amount: new_allowance,
                expiration_ledger: allowance_val.expiration_ledger,
            };
            s::set_and_extend(&env, &allowance_key, &updated, TTL_REFRESH_THRESHOLD);
        }

        let key = (s::KEY_BALANCE, &from);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if current < amount {
            return Err(TokenError::InsufficientBalance);
        }
        let new_balance = current.checked_sub(amount).expect("Balance underflow");
        s::set_and_extend(&env, &key, &new_balance, TTL_REFRESH_THRESHOLD);

        let total: i128 = s::get_persistent(&env, &s::KEY_TOTAL_SUPPLY, 0i128);
        let new_total = total.checked_sub(amount).expect("Total supply underflow");
        s::set_and_extend(
            &env,
            &s::KEY_TOTAL_SUPPLY,
            &new_total,
            TTL_REFRESH_THRESHOLD,
        );

        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR));
        e::emit_transfer(&env, &from, &zero, amount);
        Ok(())
    }

    // ---- SAC admin/authorization API ----

    /// Transfer the admin role to `new_admin` (SAC `set_admin`). Only the
    /// current admin can call; the zero/burn address is rejected so the
    /// token can never be left permanently admin-less.
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), TokenError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(TokenError::NotAuthorized);
        }
        admin.require_auth();
        if Self::is_zero_address(&env, &new_admin) {
            return Err(TokenError::InvalidAdmin);
        }

        s::set_persistent(&env, &s::KEY_ADMIN, &new_admin);
        s::bump_persistent_ttl(&env, &s::KEY_ADMIN, TTL_REFRESH_THRESHOLD);

        SetAdminEvent {
            old_admin: stored_admin,
            new_admin: new_admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Whether `owner` is authorized to hold/move tokens. Missing entries
    /// read as authorized (SAC default).
    pub fn authorized(env: Env, owner: Address) -> bool {
        Self::check_auth(&env, &owner)
    }

    /// Freeze or unfreeze an address (SAC `set_authorized`). Only the admin
    /// can call. When clawback is enabled, de-authorizing downgrades the
    /// address to `Clawbackable` (it may still be clawed back from); when it
    /// is disabled, the address is fully frozen. Re-authorizing restores the
    /// default state and prunes the stored entry to free rent.
    pub fn set_authorized(
        env: Env,
        admin: Address,
        owner: Address,
        authorize: bool,
    ) -> Result<(), TokenError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(TokenError::NotAuthorized);
        }
        admin.require_auth();

        let auth_key = (KEY_AUTH_STATE, &owner);
        if authorize {
            if Self::is_clawback_enabled(&env) {
                s::set_and_extend(
                    &env,
                    &auth_key,
                    &AuthorizationState::Clawbackable,
                    TTL_REFRESH_THRESHOLD,
                );
            } else {
                env.storage().persistent().remove(&auth_key);
            }
        } else if Self::is_clawback_enabled(&env) {
            s::set_and_extend(
                &env,
                &auth_key,
                &AuthorizationState::Clawbackable,
                TTL_REFRESH_THRESHOLD,
            );
        } else {
            s::set_and_extend(
                &env,
                &auth_key,
                &AuthorizationState::Unauthorized,
                TTL_REFRESH_THRESHOLD,
            );
        }
        Ok(())
    }

    /// Claw back `amount` from `from` to the admin (SAC `clawback`). Requires
    /// the admin role and clawback to be enabled; the target must not be
    /// frozen. The clawed-back tokens move to the admin's balance.
    pub fn clawback(
        env: Env,
        admin: Address,
        from: Address,
        amount: i128,
    ) -> Result<(), TokenError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(TokenError::NotAuthorized);
        }
        admin.require_auth();
        if !Self::is_clawback_enabled(&env) {
            return Err(TokenError::ClawbackNotEnabled);
        }
        if amount <= 0 {
            return Err(TokenError::AmountNotPositive);
        }
        if !Self::check_auth(&env, &from) {
            return Err(TokenError::UnAuthorized);
        }

        let from_key = (s::KEY_BALANCE, &from);
        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_balance < amount {
            return Err(TokenError::InsufficientBalance);
        }
        let new_from = from_balance.checked_sub(amount).expect("Balance underflow");
        s::set_and_extend(&env, &from_key, &new_from, TTL_REFRESH_THRESHOLD);

        let admin_key = (s::KEY_BALANCE, &admin);
        let admin_balance: i128 = env.storage().persistent().get(&admin_key).unwrap_or(0);
        let new_admin_balance = admin_balance
            .checked_add(amount)
            .expect("Admin balance overflow");
        s::set_and_extend(&env, &admin_key, &new_admin_balance, TTL_REFRESH_THRESHOLD);

        ClawbackEvent {
            from: from.clone(),
            amount,
        }
        .publish(&env);
        e::emit_transfer(&env, &from, &admin, amount);
        Ok(())
    }

    /// Enable or disable clawback (SAC `set_clawback_enabled`). Only the
    /// admin can call. Setting it to its current value is a no-op.
    pub fn set_clawback_enabled(env: Env, admin: Address, enabled: bool) -> Result<(), TokenError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(TokenError::NotAuthorized);
        }
        admin.require_auth();

        if Self::is_clawback_enabled(&env) == enabled {
            return Ok(());
        }
        s::set_and_extend(&env, &KEY_CLAWBACK_ENABLED, &enabled, TTL_REFRESH_THRESHOLD);

        // The admin can always be clawed back from once clawback is enabled
        // (SAC semantics: the admin's own state becomes Clawbackable).
        let admin_key = (KEY_AUTH_STATE, &stored_admin);
        if enabled {
            s::set_and_extend(
                &env,
                &admin_key,
                &AuthorizationState::Clawbackable,
                TTL_REFRESH_THRESHOLD,
            );
        } else {
            env.storage().persistent().remove(&admin_key);
        }

        ClawbackEnabledEvent { enabled }.publish(&env);
        Ok(())
    }

    /// Whether clawback is enabled. Defaults to false.
    pub fn clawback_enabled(env: Env) -> bool {
        Self::is_clawback_enabled(&env)
    }

    // ---- Getters ----

    pub fn name(env: Env) -> String {
        s::get_persistent(&env, &s::KEY_NAME, String::from_str(&env, "DripToken"))
    }

    pub fn symbol(env: Env) -> String {
        s::get_persistent(&env, &s::KEY_SYMBOL, String::from_str(&env, "DRIP"))
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&s::KEY_DECIMALS)
            .unwrap_or(7)
    }

    pub fn balance(env: Env, owner: Address) -> i128 {
        let key = (s::KEY_BALANCE, &owner);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        s::get_persistent(&env, &s::KEY_TOTAL_SUPPLY, 0i128)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        let key = (KEY_ALLOWANCES, &owner, &spender);
        let val: AllowanceValue = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            });
        // Return 0 if expired. This is a read-only getter — do NOT mutate
        // storage here (removing the expired entry is transfer_from's job).
        let current_ledger = env.ledger().sequence();
        if val.expiration_ledger > 0 && current_ledger > val.expiration_ledger {
            return 0;
        }
        val.amount
    }

    /// Allowance value including its expiration ledger. The plain allowance()
    /// getter collapses an expired grant to 0, so frontends and auditors that
    /// need to show *when* a grant lapses (or that it already did) can read
    /// the raw record. Missing allowances read as amount 0 / expiration 0.
    pub fn get_allowance_detail(env: Env, owner: Address, spender: Address) -> AllowanceValue {
        let key = (KEY_ALLOWANCES, &owner, &spender);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            })
    }

    pub fn admin(env: Env) -> Address {
        s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        )
    }

    pub fn metadata(env: Env) -> TokenMetadata {
        TokenMetadata {
            name: Self::name(env.clone()),
            symbol: Self::symbol(env.clone()),
            decimals: Self::decimals(env),
        }
    }

    pub fn get_minter(env: Env) -> Option<Address> {
        env.storage().persistent().get(&KEY_MINTER)
    }

    /// Contract interface version — bump on breaking changes.
    pub fn token_version() -> u32 {
        1
    }

    // ---- Helpers ----

    fn is_zero_address(env: &Env, addr: &Address) -> bool {
        let zero = Address::from_string(&String::from_str(env, ZERO_ADDRESS_STR));
        *addr == zero
    }

    /// Read an address's stored authorization state, defaulting to
    /// `Authorized` when no entry exists (SAC behavior).
    fn read_auth_state(env: &Env, owner: &Address) -> AuthorizationState {
        let auth_key = (KEY_AUTH_STATE, owner);
        env.storage()
            .persistent()
            .get(&auth_key)
            .unwrap_or(AuthorizationState::Authorized)
    }

    /// Whether an address may hold/move tokens. `Clawbackable` addresses are
    /// authorized (they can transact normally) but subject to clawback;
    /// `Unauthorized` addresses are frozen.
    fn check_auth(env: &Env, owner: &Address) -> bool {
        match Self::read_auth_state(env, owner) {
            AuthorizationState::Authorized | AuthorizationState::Clawbackable => true,
            AuthorizationState::Unauthorized => false,
        }
    }

    fn is_clawback_enabled(env: &Env) -> bool {
        env.storage()
            .persistent()
            .get(&KEY_CLAWBACK_ENABLED)
            .unwrap_or(false)
    }
}

#[cfg(test)]
#[allow(unused_imports)]
mod token_test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::Env;

    #[test]
    fn test_initialize_and_mint() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let contract_id = env.register(DripToken, ());

        let client = DripTokenClient::new(&env, &contract_id);

        // Initialize
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DripToken"),
            &String::from_str(&env, "DRIP"),
            &7u32,
        );

        assert_eq!(client.name(), String::from_str(&env, "DripToken"));
        assert_eq!(client.symbol(), String::from_str(&env, "DRIP"));
        assert_eq!(client.decimals(), 7u32);
        assert_eq!(client.total_supply(), 0i128);
        assert_eq!(client.token_version(), 1u32);

        // Mint
        client.mint(&admin, &recipient, &1000i128);
        assert_eq!(client.balance(&recipient), 1000i128);
        assert_eq!(client.total_supply(), 1000i128);
    }

    #[test]
    fn test_uninitialized_reads_return_safe_defaults() {
        let env = Env::default();
        let user = Address::generate(&env);
        let spender = Address::generate(&env);

        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);

        // A fresh contract (never initialized) must read as empty, not panic:
        // frontends read these getters before any init transaction exists.
        assert_eq!(client.balance(&user), 0);
        assert_eq!(client.total_supply(), 0);
        assert_eq!(client.allowance(&user, &spender), 0);
        assert_eq!(client.get_minter(), None);
        assert_eq!(client.token_version(), 1u32);

        // The admin getter must not panic pre-initialization; it reports the
        // zero address, which is unusable for any admin-gated call.
        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR));
        assert_eq!(client.admin(), zero);
    }

    #[test]
    fn test_initialize_twice_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);

        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        assert!(matches!(
            client.try_initialize_token(
                &admin,
                &String::from_str(&env, "DT"),
                &String::from_str(&env, "D"),
                &7u32
            ),
            Err(Ok(TokenError::AlreadyInitialized))
        ));
    }

    #[test]
    fn test_initialize_rejects_invalid_decimals() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);

        assert!(matches!(
            client.try_initialize_token(
                &admin,
                &String::from_str(&env, "DT"),
                &String::from_str(&env, "D"),
                &19u32
            ),
            Err(Ok(TokenError::InvalidDecimals))
        ));
    }

    #[test]
    fn test_transfer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let contract_id = env.register(DripToken, ());

        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &alice, &1000i128);

        // Transfer
        client.transfer(&alice, &bob, &300i128);
        assert_eq!(client.balance(&alice), 700i128);
        assert_eq!(client.balance(&bob), 300i128);
        assert_eq!(client.total_supply(), 1000i128);
    }

    #[test]
    fn test_transfer_to_zero_address_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &alice, &1000i128);

        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR));
        assert!(matches!(
            client.try_transfer(&alice, &zero, &100i128),
            Err(Ok(TokenError::InvalidRecipient))
        ));
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &alice, &100i128);

        assert!(matches!(
            client.try_transfer(&alice, &bob, &101i128),
            Err(Ok(TokenError::InsufficientBalance))
        ));
    }

    #[test]
    fn test_approve_and_transfer_from() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let contract_id = env.register(DripToken, ());

        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &owner, &1000i128);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        client.approve(&owner, &spender, &500i128, &exp_ledger);

        // Transfer from
        client.transfer_from(&spender, &owner, &recipient, &200i128);
        assert_eq!(client.balance(&owner), 800i128);
        assert_eq!(client.balance(&recipient), 200i128);
        assert_eq!(client.allowance(&owner, &spender), 300i128);
    }

    #[test]
    fn test_approve_rejects_self_spend() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        let exp_ledger = env.ledger().sequence() + 9999u32;
        assert!(matches!(
            client.try_approve(&owner, &owner, &500i128, &exp_ledger),
            Err(Ok(TokenError::SpenderEqualsOwner))
        ));
    }

    #[test]
    fn test_burn() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let contract_id = env.register(DripToken, ());

        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &alice, &1000i128);

        client.burn(&alice, &400i128);
        assert_eq!(client.balance(&alice), 600i128);
        assert_eq!(client.total_supply(), 600i128);
    }

    /// Test that an authorized minter (e.g., governance) can mint tokens.
    #[test]
    fn test_set_minter_and_mint() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let minter = Address::generate(&env);
        let recipient = Address::generate(&env);
        let contract_id = env.register(DripToken, ());

        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        // Authorize minter
        client.set_minter(&admin, &minter, &true);
        assert!(client.get_minter().is_some());

        // Minter can now mint
        client.mint(&minter, &recipient, &500i128);
        assert_eq!(client.balance(&recipient), 500i128);
        assert_eq!(client.total_supply(), 500i128);

        // Revoke minter
        client.set_minter(&admin, &minter, &false);
        assert!(client.get_minter().is_none());
    }

    /// Non-admin cannot set the minter.
    #[test]
    fn test_set_minter_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let minter = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        assert!(matches!(
            client.try_set_minter(&attacker, &minter, &true),
            Err(Ok(TokenError::NotAuthorized))
        ));
    }

    /// SEP-41 symbols and token names have bounded lengths.
    #[test]
    fn test_initialize_rejects_invalid_metadata() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);

        let long_name = String::from_str(&env, &"A".repeat(200));
        assert!(matches!(
            client.try_initialize_token(&admin, &long_name, &String::from_str(&env, "D"), &7u32),
            Err(Ok(TokenError::InvalidMetadata))
        ));

        let long_symbol = String::from_str(&env, &"S".repeat(20));
        assert!(matches!(
            client.try_initialize_token(&admin, &String::from_str(&env, "DT"), &long_symbol, &7u32),
            Err(Ok(TokenError::InvalidMetadata))
        ));

        assert!(matches!(
            client.try_initialize_token(
                &admin,
                &String::from_str(&env, ""),
                &String::from_str(&env, "D"),
                &7u32
            ),
            Err(Ok(TokenError::InvalidMetadata))
        ));
    }

    /// Minting straight to the burn address would permanently inflate the
    /// supply with un-spendable tokens.
    #[test]
    fn test_mint_to_zero_address_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR));
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        assert!(matches!(
            client.try_mint(&admin, &zero, &100i128),
            Err(Ok(TokenError::InvalidRecipient))
        ));
        assert_eq!(client.total_supply(), 0i128);
    }

    /// Writes must refresh the persistent-entry TTL so user balances cannot
    /// silently expire while the network is quiet.
    #[test]
    fn test_balance_writes_extend_ttl() {
        use soroban_sdk::testutils::storage::Persistent as _;

        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        client.mint(&admin, &alice, &1000i128);
        let balance_key = (s::KEY_BALANCE, &alice);
        let ttl_after_write = env.as_contract(&contract_id, || {
            env.storage().persistent().get_ttl(&balance_key)
        });
        // Well above the default ~4095-ledger write TTL, proving the entry
        // was extended toward the ledger max.
        assert!(ttl_after_write > 4096);
    }

    /// The allowance-detail getter exposes the raw amount and expiration
    /// ledger, and reports 0/0 for a missing allowance.
    #[test]
    fn test_allowance_detail_getter() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        // No allowance yet: 0 / 0.
        let missing = client.get_allowance_detail(&owner, &spender);
        assert_eq!(missing.amount, 0i128);
        assert_eq!(missing.expiration_ledger, 0u32);

        let exp = env.ledger().sequence() + 5000u32;
        client.approve(&owner, &spender, &300i128, &exp);
        let detail = client.get_allowance_detail(&owner, &spender);
        assert_eq!(detail.amount, 300i128);
        assert_eq!(detail.expiration_ledger, exp);
    }

    /// Admin/config entries written once at init carry the network default
    /// TTL (~4096 ledgers) and are almost never rewritten — a quiet contract
    /// would otherwise lose its ADMIN/NAME/SYMBOL entries and brick every
    /// admin-gated function. A read must extend the entry's TTL so the
    /// contract stays usable for as long as anyone interacts with it.
    #[test]
    fn test_config_reads_extend_ttl() {
        use soroban_sdk::testutils::storage::Persistent as _;

        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        // Freshly written with the default TTL — far below the refresh
        // threshold the storage helper extends toward.
        let ttl_before = env.as_contract(&contract_id, || {
            env.storage().persistent().get_ttl(&s::KEY_ADMIN)
        });
        assert!(ttl_before < TTL_REFRESH_THRESHOLD);

        // The admin getter reads the entry through the shared helper, which
        // must extend it toward the ledger max.
        client.admin();
        let ttl_after = env.as_contract(&contract_id, || {
            env.storage().persistent().get_ttl(&s::KEY_ADMIN)
        });
        assert!(ttl_after > ttl_before);
        assert!(ttl_after > TTL_REFRESH_THRESHOLD);
    }

    /// Revoking an allowance (approve 0) removes the stored entry instead of
    /// keeping a zero-value record alive, and re-approving afterwards works.
    #[test]
    fn test_approve_zero_prunes_allowance_storage() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        let exp = env.ledger().sequence() + 9999u32;
        client.approve(&owner, &spender, &500i128, &exp);
        assert_eq!(client.allowance(&owner, &spender), 500i128);

        // Revoke.
        client.approve(&owner, &spender, &0i128, &exp);
        assert_eq!(client.allowance(&owner, &spender), 0i128);

        // The entry must be gone from storage, not stored as a zero value.
        let key = (KEY_ALLOWANCES, &owner, &spender);
        let present = env.as_contract(&contract_id, || env.storage().persistent().has(&key));
        assert!(!present);

        // Re-approving after revocation still works.
        client.approve(&owner, &spender, &100i128, &exp);
        assert_eq!(client.allowance(&owner, &spender), 100i128);
    }

    /// Allowances stay usable through their expiration ledger, then read as
    /// zero and reject spends once the ledger passes it.
    #[test]
    fn test_allowance_expiry_boundaries() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &owner, &1000i128);

        let exp = env.ledger().sequence() + 10u32;
        client.approve(&owner, &spender, &300i128, &exp);

        // Still spendable on the expiration ledger itself.
        env.ledger().set_sequence_number(exp);
        client.transfer_from(&spender, &owner, &recipient, &10i128);
        assert_eq!(client.allowance(&owner, &spender), 290i128);

        // Past the expiration ledger the getter reads zero.
        env.ledger().set_sequence_number(exp + 1);
        assert_eq!(client.allowance(&owner, &spender), 0i128);

        // A spend attempt past the expiration ledger is rejected (the failed
        // call rolls back, so the stale entry itself is left for a later
        // approve to overwrite or the TTL to reclaim).
        env.ledger().set_sequence_number(exp + 2);
        assert!(matches!(
            client.try_transfer_from(&spender, &owner, &recipient, &5i128),
            Err(Ok(TokenError::AllowanceExpired))
        ));
        assert_eq!(client.allowance(&owner, &spender), 0i128);

        // Renewing the allowance after expiry works and restores spends.
        let renewed = env.ledger().sequence() + 50u32;
        client.approve(&owner, &spender, &100i128, &renewed);
        client.transfer_from(&spender, &owner, &recipient, &40i128);
        assert_eq!(client.allowance(&owner, &spender), 60i128);
    }

    /// Expirations in the past (or the current ledger) are meaningless.
    #[test]
    fn test_approve_rejects_past_or_current_expiration() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        let current = env.ledger().sequence();
        assert!(matches!(
            client.try_approve(&owner, &spender, &100i128, &current),
            Err(Ok(TokenError::ExpirationInPast))
        ));
        assert!(matches!(
            client.try_approve(&owner, &spender, &100i128, &current.saturating_sub(1)),
            Err(Ok(TokenError::ExpirationInPast))
        ));
    }

    /// transfer_from must not consume the allowance when the owner's
    /// balance is too small — the whole call reverts, so the allowance
    /// survives for later spends.
    #[test]
    fn test_transfer_from_insufficient_balance_keeps_allowance() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        // Allowance (500) exceeds the owner's balance (100).
        client.mint(&admin, &owner, &100i128);
        let exp = env.ledger().sequence() + 9999u32;
        client.approve(&owner, &spender, &500i128, &exp);

        assert!(matches!(
            client.try_transfer_from(&spender, &owner, &recipient, &200i128),
            Err(Ok(TokenError::InsufficientBalance))
        ));
        // The failed call rolled back: allowance and balances are untouched.
        assert_eq!(client.allowance(&owner, &spender), 500i128);
        assert_eq!(client.balance(&owner), 100i128);
        assert_eq!(client.balance(&recipient), 0i128);
    }

    /// Revoking an allowance is timeless: it must not require a future
    /// expiration ledger, even when the allowance being cleared is stale.
    #[test]
    fn test_revoke_ignores_expiration() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        let current = env.ledger().sequence();
        let future = current + 50u32;
        client.approve(&owner, &spender, &500i128, &future);

        // Revoking with the current ledger (previously ExpirationInPast)
        // succeeds and prunes the entry.
        client.approve(&owner, &spender, &0i128, &current);
        assert_eq!(client.allowance(&owner, &spender), 0i128);

        // Revoking with a past ledger works too, including for a stale
        // allowance that already expired on its own.
        client.approve(&owner, &spender, &200i128, &future);
        env.ledger().set_sequence_number(future + 1);
        client.approve(&owner, &spender, &0i128, &future);
        assert_eq!(client.allowance(&owner, &spender), 0i128);

        // Non-zero approvals still enforce the future-expiration rule.
        env.ledger().set_sequence_number(current);
        assert!(matches!(
            client.try_approve(&owner, &spender, &100i128, &current),
            Err(Ok(TokenError::ExpirationInPast))
        ));
    }

    /// A negative allowance is meaningless and must be rejected up front.
    #[test]
    fn test_approve_rejects_negative_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        let exp_ledger = env.ledger().sequence() + 9999u32;
        assert!(matches!(
            client.try_approve(&owner, &spender, &(-1i128), &exp_ledger),
            Err(Ok(TokenError::AmountNotPositive))
        ));
    }

    // ---- SAC compatibility ----

    /// The admin role can be transferred to a new address; only the new
    /// admin can then exercise admin-gated functions.
    #[test]
    fn test_set_admin_transfers_role() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        // Non-admin cannot transfer the role.
        assert!(matches!(
            client.try_set_admin(&attacker, &new_admin),
            Err(Ok(TokenError::NotAuthorized))
        ));

        client.set_admin(&admin, &new_admin);
        assert_eq!(client.admin(), new_admin);

        // The old admin has lost the role; the new admin has it.
        let minter = Address::generate(&env);
        assert!(matches!(
            client.try_set_minter(&admin, &minter, &true),
            Err(Ok(TokenError::NotAuthorized))
        ));
        client.set_minter(&new_admin, &minter, &true);
    }

    /// Handing the admin role to the burn address would brick every
    /// admin-gated function forever — reject it.
    #[test]
    fn test_set_admin_rejects_zero_address() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR));
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        assert!(matches!(
            client.try_set_admin(&admin, &zero),
            Err(Ok(TokenError::InvalidAdmin))
        ));
        assert_eq!(client.admin(), admin);
    }

    /// Untouched addresses read as authorized by default, so enabling SAC
    /// controls does not change behavior for existing users.
    #[test]
    fn test_authorization_defaults_authorized() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        assert!(client.authorized(&user));
        assert!(!client.clawback_enabled());
    }

    /// Freezing an address blocks transfers in both directions; re-
    /// authorizing restores them.
    #[test]
    fn test_set_authorized_freezes_address() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &alice, &1000i128);

        // Non-admin cannot freeze anyone.
        assert!(matches!(
            client.try_set_authorized(&bob, &alice, &false),
            Err(Ok(TokenError::NotAuthorized))
        ));

        client.set_authorized(&admin, &alice, &false);
        assert!(!client.authorized(&alice));

        // Alice cannot send...
        assert!(matches!(
            client.try_transfer(&alice, &bob, &100i128),
            Err(Ok(TokenError::UnAuthorized))
        ));
        // ...nor receive.
        client.mint(&admin, &bob, &500i128);
        assert!(matches!(
            client.try_transfer(&bob, &alice, &50i128),
            Err(Ok(TokenError::UnAuthorized))
        ));
        // ...nor burn.
        assert!(matches!(
            client.try_burn(&alice, &10i128),
            Err(Ok(TokenError::UnAuthorized))
        ));

        // Re-authorizing restores normal operation.
        client.set_authorized(&admin, &alice, &true);
        assert!(client.authorized(&alice));
        client.transfer(&alice, &bob, &100i128);
        assert_eq!(client.balance(&alice), 900i128);
    }

    /// A frozen address cannot receive freshly minted tokens.
    #[test]
    fn test_mint_to_frozen_address_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );

        client.set_authorized(&admin, &user, &false);
        assert!(matches!(
            client.try_mint(&admin, &user, &100i128),
            Err(Ok(TokenError::UnAuthorized))
        ));
        assert_eq!(client.total_supply(), 0i128);
    }

    /// Clawback requires the admin role and an enabled flag.
    #[test]
    fn test_clawback_requires_enabled_and_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &user, &500i128);

        // Disabled by default: clawback rejected even for the admin.
        assert!(matches!(
            client.try_clawback(&admin, &user, &100i128),
            Err(Ok(TokenError::ClawbackNotEnabled))
        ));

        client.set_clawback_enabled(&admin, &true);
        assert!(client.clawback_enabled());

        // Non-admin cannot claw back.
        assert!(matches!(
            client.try_clawback(&attacker, &user, &100i128),
            Err(Ok(TokenError::NotAuthorized))
        ));
    }

    /// A successful clawback moves tokens from the target to the admin
    /// without touching total supply.
    #[test]
    fn test_clawback_moves_tokens_to_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &user, &500i128);
        client.set_clawback_enabled(&admin, &true);

        client.clawback(&admin, &user, &150i128);
        assert_eq!(client.balance(&user), 350i128);
        assert_eq!(client.balance(&admin), 150i128);
        assert_eq!(client.total_supply(), 500i128);

        // Clawing back more than the balance fails.
        assert!(matches!(
            client.try_clawback(&admin, &user, &9999i128),
            Err(Ok(TokenError::InsufficientBalance))
        ));

        // With clawback enabled, de-authorizing the user downgrades them to
        // Clawbackable — still subject to clawback (that is the point), so
        // the admin can keep clawing back.
        client.set_authorized(&admin, &user, &false);
        assert!(client.authorized(&user));
        client.clawback(&admin, &user, &10i128);
        assert_eq!(client.balance(&user), 340i128);
        assert_eq!(client.balance(&admin), 160i128);
    }

    /// With clawback enabled, de-authorizing downgrades to Clawbackable
    /// (still subject to clawback) and re-authorizing keeps it clawbackable.
    #[test]
    fn test_authorization_states_with_clawback_enabled() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &user, &100i128);
        client.set_clawback_enabled(&admin, &true);

        // De-authorizing under clawback: user stays authorized (can transact)
        // but is clawbackable.
        client.set_authorized(&admin, &user, &false);
        assert!(client.authorized(&user));
        client.clawback(&admin, &user, &40i128);
        assert_eq!(client.balance(&user), 60i128);

        // Re-authorizing keeps the clawbackable state, so a later clawback
        // still works.
        client.set_authorized(&admin, &user, &true);
        assert!(client.authorized(&user));
        client.clawback(&admin, &user, &20i128);
        assert_eq!(client.balance(&user), 40i128);

        // Disabling clawback again makes the next set_authorized(false)
        // actually freeze.
        client.set_clawback_enabled(&admin, &false);
        client.set_authorized(&admin, &user, &false);
        assert!(!client.authorized(&user));
    }

    /// burn_from consumes the spender's allowance and reduces total supply.
    #[test]
    fn test_burn_from_consumes_allowance() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let contract_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &contract_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        client.mint(&admin, &owner, &1000i128);

        let exp = env.ledger().sequence() + 9999u32;
        client.approve(&owner, &spender, &500i128, &exp);
        client.burn_from(&spender, &owner, &200i128);

        assert_eq!(client.balance(&owner), 800i128);
        assert_eq!(client.allowance(&owner, &spender), 300i128);
        assert_eq!(client.total_supply(), 800i128);

        // Burning more than the allowance fails and reverts.
        assert!(matches!(
            client.try_burn_from(&spender, &owner, &9999i128),
            Err(Ok(TokenError::InsufficientAllowance))
        ));
        assert_eq!(client.balance(&owner), 800i128);
    }
}
