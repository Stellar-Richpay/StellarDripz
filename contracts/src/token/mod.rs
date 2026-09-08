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

// ---- Contract Errors ----

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

// ---- Storage Keys ----

const KEY_ALLOWANCES: Symbol = symbol_short!("ALLOW_M");
const KEY_MINTER: Symbol = symbol_short!("MINTER");

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

        e::publish(&env, (e::EVENT_APPROVE, &owner, &spender), amount);
        Ok(())
    }

    /// Burn tokens from the caller's balance. Uses checked arithmetic.
    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();

        if amount <= 0 {
            return Err(TokenError::AmountNotPositive);
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
}
