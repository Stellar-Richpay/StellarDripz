use soroban_sdk::{contract, contractimpl, contracterror, contracttype, Address, Env, String, Symbol, symbol_short};
use crate::common::storage as s;
use crate::common::events as e;
use crate::common::constants::ZERO_ADDRESS_STR;
use crate::token;

// ---- Contract Errors ----

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    PoolNotActive = 3,
    BelowMinStake = 4,
    ExceedsMaxStake = 5,
    InsufficientStake = 6,
    TokensLocked = 7,
}

// ---- Data Types ----

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StakeInfo {
    pub amount: i128,
    pub start_ledger: u32,
    pub reward_claimed: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PoolConfig {
    pub reward_rate: i128,
    pub min_stake: i128,
    pub max_stake: i128,
    pub lock_period: u32,
    pub active: bool,
}

const KEY_POOL_CONFIG: Symbol = symbol_short!("POOL_CFG");
const KEY_TOTAL_STAKED: Symbol = symbol_short!("TOT_STKD");
const KEY_REWARD_POOL: Symbol = symbol_short!("REW_POOL");
const KEY_TOKEN_ID: Symbol = symbol_short!("TOK_ID");

/// Default max stake (10 trillion with 7 decimals = 1,000,000 tokens)
pub const DEFAULT_MAX_STAKE: i128 = 10_000_000_000_000i128;
/// Reward calculation divisor (10 million = 10^7 for decimal precision)
pub const REWARD_DIVISOR: i128 = 10_000_000i128;

#[contract]
pub struct DripPool;

#[contracttype]
#[derive(Clone)]
pub enum StakeKey {
    Stake(Address),
}

#[contractimpl]
impl DripPool {
    pub fn initialize_pool(env: Env, admin: Address, token_contract_id: Address, reward_rate: i128, min_stake: i128, lock_period: u32) {
        if env.storage().persistent().has(&s::KEY_ADMIN) { panic!("Already initialized"); }
        admin.require_auth();
        s::set_persistent(&env, &s::KEY_ADMIN, &admin);
        s::set_persistent(&env, &KEY_TOKEN_ID, &token_contract_id);
        let config = PoolConfig { reward_rate, min_stake, max_stake: DEFAULT_MAX_STAKE, lock_period, active: true };
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        s::set_persistent(&env, &KEY_TOTAL_STAKED, &0i128);
        s::set_persistent(&env, &KEY_REWARD_POOL, &0i128);
        e::publish(&env, (symbol_short!("pool_init"), &admin), config.reward_rate);
    }

    pub fn stake(env: Env, user: Address, amount: i128) {
        user.require_auth();
        let config: PoolConfig = s::get_persistent(&env, &KEY_POOL_CONFIG, PoolConfig { reward_rate: 0, min_stake: 0, max_stake: 0, lock_period: 0, active: false });
        if !config.active { panic!("Pool is not active"); }
        if amount < config.min_stake { panic!("Below minimum stake"); }
        let token_id: Address = s::get_persistent(&env, &KEY_TOKEN_ID, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)));
        let pool_address = env.current_contract_address();
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client
            .transfer_from(&pool_address, &user, &pool_address, &amount);
        let stake_key = StakeKey::Stake(user.clone());
        let existing = env.storage().persistent().get(&stake_key).unwrap_or(StakeInfo { amount: 0, start_ledger: 0, reward_claimed: 0 });
        let new_total = existing.amount.checked_add(amount).expect("Stake overflow");
        if new_total > config.max_stake { panic!("Exceeds maximum stake"); }
        let mut existing_stake = existing;
        if existing_stake.amount > 0 { let pending = Self::calculate_reward(env.clone(), user.clone()); if pending > 0 { existing_stake.reward_claimed = existing_stake.reward_claimed.checked_add(pending).expect("Reward overflow"); } }
        let current_ledger = env.ledger().sequence();
        existing_stake.amount = new_total;
        existing_stake.start_ledger = current_ledger;
        env.storage().persistent().set(&stake_key, &existing_stake);
        let total: i128 = s::get_persistent(&env, &KEY_TOTAL_STAKED, 0i128);
        let new_total_staked = total.checked_add(amount).expect("Total staked overflow");
        s::set_persistent(&env, &KEY_TOTAL_STAKED, &new_total_staked);
        e::publish(&env, (e::EVENT_STAKE, &user), amount);
    }

    pub fn unstake(env: Env, user: Address, amount: i128) {
        user.require_auth();
        let config: PoolConfig = s::get_persistent(&env, &KEY_POOL_CONFIG, PoolConfig { reward_rate: 0, min_stake: 0, max_stake: 0, lock_period: 0, active: false });
        let stake_key = StakeKey::Stake(user.clone());
        let existing = env.storage().persistent().get(&stake_key).unwrap_or(StakeInfo { amount: 0, start_ledger: 0, reward_claimed: 0 });
        if existing.amount < amount { panic!("Insufficient staked amount"); }
        let mut existing_stake = existing;
        let current_ledger = env.ledger().sequence();
        let locked_until = existing_stake.start_ledger + config.lock_period;
        if current_ledger < locked_until { panic!("Tokens are locked"); }
        if existing_stake.amount > 0 { let pending = Self::calculate_reward(env.clone(), user.clone()); if pending > 0 { existing_stake.reward_claimed = existing_stake.reward_claimed.checked_add(pending).expect("Reward overflow"); } }
        existing_stake.amount = existing_stake.amount.checked_sub(amount).expect("Stake underflow");
        existing_stake.start_ledger = current_ledger;
        if existing_stake.amount == 0 { env.storage().persistent().remove(&stake_key); } else { env.storage().persistent().set(&stake_key, &existing_stake); }
        let total: i128 = s::get_persistent(&env, &KEY_TOTAL_STAKED, 0i128);
        let new_total = total.checked_sub(amount).expect("Total staked underflow");
        s::set_persistent(&env, &KEY_TOTAL_STAKED, &new_total);
        let token_id: Address = s::get_persistent(&env, &KEY_TOKEN_ID, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)));
        let pool_address = env.current_contract_address();
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client
            .transfer(&pool_address, &user, &amount);
        e::publish(&env, (e::EVENT_UNSTAKE, &user), amount);
    }

    pub fn claim_reward(env: Env, user: Address) -> i128 {
        user.require_auth();
        let stake_key = StakeKey::Stake(user.clone());
        let mut existing_stake: StakeInfo = env.storage().persistent().get(&stake_key).unwrap_or(StakeInfo { amount: 0, start_ledger: 0, reward_claimed: 0 });
        let pending = Self::calculate_reward(env.clone(), user.clone());
        let total_reward = existing_stake.reward_claimed + pending;
        if total_reward <= 0 { return 0; }

        // Cap reward at available pool balance (non-panicking partial payout)
        let mut reward_pool: i128 = s::get_persistent(&env, &KEY_REWARD_POOL, 0i128);
        let claimable = if reward_pool < total_reward { reward_pool } else { total_reward };
        if claimable <= 0 { return 0; }

        reward_pool = reward_pool.checked_sub(claimable).expect("Reward pool underflow");
        s::set_persistent(&env, &KEY_REWARD_POOL, &reward_pool);

        // Transfer reward tokens to user via cross-contract call
        let token_id: Address = s::get_persistent(&env, &KEY_TOKEN_ID, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)));
        let pool_address = env.current_contract_address();
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client
            .transfer(&pool_address, &user, &claimable);

        // Carry forward unclaimed portion if pool was insufficient
        let unclaimed = total_reward - claimable;
        existing_stake.reward_claimed = unclaimed;
        existing_stake.start_ledger = env.ledger().sequence();
        env.storage().persistent().set(&stake_key, &existing_stake);

        e::publish(&env, (e::EVENT_REWARD, &user), claimable);
        claimable
    }

    pub fn calculate_reward(env: Env, user: Address) -> i128 {
        let config: PoolConfig = s::get_persistent(&env, &KEY_POOL_CONFIG, PoolConfig { reward_rate: 0, min_stake: 0, max_stake: 0, lock_period: 0, active: false });
        let stake_key = StakeKey::Stake(user.clone());
        let stake: StakeInfo = env.storage().persistent().get(&stake_key).unwrap_or(StakeInfo { amount: 0, start_ledger: 0, reward_claimed: 0 });
        if stake.amount == 0 || config.reward_rate == 0 { return 0; }
        let current_ledger = env.ledger().sequence();
        let elapsed = (current_ledger as i128) - (stake.start_ledger as i128);
        if elapsed <= 0 { return 0; }
        (stake.amount * config.reward_rate * elapsed) / REWARD_DIVISOR
    }

    pub fn fund_rewards(env: Env, admin: Address, amount: i128) {
        let stored_admin: Address = s::get_persistent(&env, &s::KEY_ADMIN, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)));
        if admin != stored_admin { panic!("Only admin"); }
        admin.require_auth();
        // Transfer reward tokens from admin to pool's token balance
        let token_id: Address = s::get_persistent(&env, &KEY_TOKEN_ID, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)));
        let pool_address = env.current_contract_address();
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client
            .transfer_from(&pool_address, &admin, &pool_address, &amount);
        // Update on-chain reward pool tracking
        let mut reward_pool: i128 = s::get_persistent(&env, &KEY_REWARD_POOL, 0i128);
        reward_pool = reward_pool.checked_add(amount).expect("Reward pool overflow");
        s::set_persistent(&env, &KEY_REWARD_POOL, &reward_pool);
        e::publish(&env, (symbol_short!("rew_fund"), &admin), amount);
    }

    pub fn set_reward_rate(env: Env, admin: Address, reward_rate: i128) {
        let stored_admin: Address = s::get_persistent(&env, &s::KEY_ADMIN, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)));
        if admin != stored_admin { panic!("Only admin"); }
        admin.require_auth();
        let mut config: PoolConfig = s::get_persistent(&env, &KEY_POOL_CONFIG, PoolConfig { reward_rate: 0, min_stake: 0, max_stake: 0, lock_period: 0, active: false });
        config.reward_rate = reward_rate;
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        e::publish(&env, (symbol_short!("rew_rate"), &admin), reward_rate);
    }

    pub fn set_min_stake(env: Env, admin: Address, min_stake: i128) {
        let stored_admin: Address = s::get_persistent(&env, &s::KEY_ADMIN, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)));
        if admin != stored_admin { panic!("Only admin"); }
        admin.require_auth();
        let mut config: PoolConfig = s::get_persistent(&env, &KEY_POOL_CONFIG, PoolConfig { reward_rate: 0, min_stake: 0, max_stake: 0, lock_period: 0, active: false });
        config.min_stake = min_stake;
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        e::publish(&env, (symbol_short!("min_stk"), &admin), min_stake);
    }

    pub fn set_lock_period(env: Env, admin: Address, lock_period: u32) {
        let stored_admin: Address = s::get_persistent(&env, &s::KEY_ADMIN, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)));
        if admin != stored_admin { panic!("Only admin"); }
        admin.require_auth();
        let mut config: PoolConfig = s::get_persistent(&env, &KEY_POOL_CONFIG, PoolConfig { reward_rate: 0, min_stake: 0, max_stake: 0, lock_period: 0, active: false });
        config.lock_period = lock_period;
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        e::publish(&env, (symbol_short!("lock_per"), &admin), lock_period);
    }

    pub fn set_active(env: Env, admin: Address, active: bool) {
        let stored_admin: Address = s::get_persistent(&env, &s::KEY_ADMIN, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)));
        if admin != stored_admin { panic!("Only admin"); }
        admin.require_auth();
        let mut config: PoolConfig = s::get_persistent(&env, &KEY_POOL_CONFIG, PoolConfig { reward_rate: 0, min_stake: 0, max_stake: 0, lock_period: 0, active: false });
        config.active = active;
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        e::publish(&env, (symbol_short!("pool_act"), &admin), active);
    }

    pub fn get_stake(env: Env, user: Address) -> StakeInfo {
        let key = StakeKey::Stake(user);
        env.storage().persistent().get(&key).unwrap_or(StakeInfo { amount: 0, start_ledger: 0, reward_claimed: 0 })
    }

    pub fn get_token_id(env: Env) -> Address {
        s::get_persistent(&env, &KEY_TOKEN_ID, Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)))
    }

    pub fn get_pool_config(env: Env) -> PoolConfig {
        s::get_persistent(&env, &KEY_POOL_CONFIG, PoolConfig { reward_rate: 0, min_stake: 0, max_stake: 0, lock_period: 0, active: false })
    }

    pub fn get_total_staked(env: Env) -> i128 {
        s::get_persistent(&env, &KEY_TOTAL_STAKED, 0i128)
    }
}

#[cfg(test)]
mod pool_test {
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;
    use super::*;
    use soroban_sdk::Env;
    use crate::token::DripToken;

    #[test]
    fn test_stake_and_unstake() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(&admin, &String::from_str(&env, "DripToken"), &String::from_str(&env, "DRIP"), &7u32);
        token_client.mint(&admin, &user, &5000i128);
        let contract_id = env.register(DripPool, ());
        let client = DripPoolClient::new(&env, &contract_id);
        client.initialize_pool(&admin, &token_id, &100i128, &10i128, &100u32);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&user, &contract_id, &5000i128, &exp_ledger);
        client.stake(&user, &500i128);
        let stake = client.get_stake(&user);
        assert_eq!(stake.amount, 500i128);
        env.ledger().set_sequence_number(200);
        client.unstake(&user, &300i128);
        let stake2 = client.get_stake(&user);
        assert_eq!(stake2.amount, 200i128);
    }

    #[test]
    fn test_reward_calculation() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(&admin, &String::from_str(&env, "DT"), &String::from_str(&env, "D"), &7u32);
        token_client.mint(&admin, &user, &5000i128);
        let contract_id = env.register(DripPool, ());
        let client = DripPoolClient::new(&env, &contract_id);
        client.initialize_pool(&admin, &token_id, &1000i128, &10i128, &0u32);
        // Set future expiration ledger for approve
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&user, &contract_id, &5000i128, &exp_ledger);
        client.stake(&user, &1000i128);
        env.ledger().set_sequence_number(200);
        let reward = client.calculate_reward(&user);
        assert!(reward > 0);
    }

    #[test]
    fn test_admin_controls() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_id = Address::generate(&env);
        let contract_id = env.register(DripPool, ());
        let client = DripPoolClient::new(&env, &contract_id);
        client.initialize_pool(&admin, &token_id, &100i128, &1i128, &0u32);
        let config = client.get_pool_config();
        assert!(config.active);
        client.set_active(&admin, &false);
        let config2 = client.get_pool_config();
        assert!(!config2.active);
    }
}

