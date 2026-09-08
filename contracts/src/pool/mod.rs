use crate::common::constants::{TTL_REFRESH_THRESHOLD, ZERO_ADDRESS_STR};
use crate::common::events as e;
use crate::common::storage as s;
use crate::token;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol,
};

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
    InvalidParameter = 8,
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
    pub fn initialize_pool(
        env: Env,
        admin: Address,
        token_contract_id: Address,
        reward_rate: i128,
        min_stake: i128,
        lock_period: u32,
    ) -> Result<(), PoolError> {
        if env.storage().persistent().has(&s::KEY_ADMIN) {
            return Err(PoolError::AlreadyInitialized);
        }
        if reward_rate < 0 || min_stake < 0 {
            return Err(PoolError::InvalidParameter);
        }
        // A minimum above the (default) maximum would make every stake fail
        // with BelowMinStake/ExceedsMaxStake; reject the impossible config.
        if min_stake > DEFAULT_MAX_STAKE {
            return Err(PoolError::InvalidParameter);
        }
        if admin.to_string() == String::from_str(&env, ZERO_ADDRESS_STR)
            || token_contract_id.to_string() == String::from_str(&env, ZERO_ADDRESS_STR)
        {
            return Err(PoolError::InvalidParameter);
        }
        admin.require_auth();
        s::set_persistent(&env, &s::KEY_ADMIN, &admin);
        s::set_persistent(&env, &KEY_TOKEN_ID, &token_contract_id);
        let config = PoolConfig {
            reward_rate,
            min_stake,
            max_stake: DEFAULT_MAX_STAKE,
            lock_period,
            active: true,
        };
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        s::set_persistent(&env, &KEY_TOTAL_STAKED, &0i128);
        s::set_persistent(&env, &KEY_REWARD_POOL, &0i128);
        s::bump_instance_ttl(&env, TTL_REFRESH_THRESHOLD);
        e::publish(
            &env,
            (symbol_short!("pool_init"), &admin),
            config.reward_rate,
        );
        Ok(())
    }

    pub fn stake(env: Env, user: Address, amount: i128) -> Result<(), PoolError> {
        user.require_auth();
        if amount <= 0 {
            return Err(PoolError::InvalidParameter);
        }
        let config: PoolConfig = s::get_persistent(
            &env,
            &KEY_POOL_CONFIG,
            PoolConfig {
                reward_rate: 0,
                min_stake: 0,
                max_stake: 0,
                lock_period: 0,
                active: false,
            },
        );
        if !config.active {
            return Err(PoolError::PoolNotActive);
        }
        if amount < config.min_stake {
            return Err(PoolError::BelowMinStake);
        }
        let token_id: Address = s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        let pool_address = env.current_contract_address();
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.transfer_from(&pool_address, &user, &pool_address, &amount);
        let stake_key = StakeKey::Stake(user.clone());
        let existing = env
            .storage()
            .persistent()
            .get(&stake_key)
            .unwrap_or(StakeInfo {
                amount: 0,
                start_ledger: 0,
                reward_claimed: 0,
            });
        let new_total = existing.amount.checked_add(amount).expect("Stake overflow");
        if new_total > config.max_stake {
            return Err(PoolError::ExceedsMaxStake);
        }
        let mut existing_stake = existing;
        if existing_stake.amount > 0 {
            let pending = Self::calculate_reward(env.clone(), user.clone());
            if pending > 0 {
                existing_stake.reward_claimed = existing_stake
                    .reward_claimed
                    .checked_add(pending)
                    .expect("Reward overflow");
            }
        }
        let current_ledger = env.ledger().sequence();
        existing_stake.amount = new_total;
        existing_stake.start_ledger = current_ledger;
        s::set_and_extend(&env, &stake_key, &existing_stake, TTL_REFRESH_THRESHOLD);
        let total: i128 = s::get_persistent(&env, &KEY_TOTAL_STAKED, 0i128);
        let new_total_staked = total.checked_add(amount).expect("Total staked overflow");
        s::set_persistent(&env, &KEY_TOTAL_STAKED, &new_total_staked);
        e::publish(&env, (e::EVENT_STAKE, &user), amount);
        Ok(())
    }

    pub fn unstake(env: Env, user: Address, amount: i128) -> Result<(), PoolError> {
        user.require_auth();
        if amount <= 0 {
            return Err(PoolError::InvalidParameter);
        }
        let config: PoolConfig = s::get_persistent(
            &env,
            &KEY_POOL_CONFIG,
            PoolConfig {
                reward_rate: 0,
                min_stake: 0,
                max_stake: 0,
                lock_period: 0,
                active: false,
            },
        );
        let stake_key = StakeKey::Stake(user.clone());
        let existing = env
            .storage()
            .persistent()
            .get(&stake_key)
            .unwrap_or(StakeInfo {
                amount: 0,
                start_ledger: 0,
                reward_claimed: 0,
            });
        if existing.amount < amount {
            return Err(PoolError::InsufficientStake);
        }
        let mut existing_stake = existing;
        let current_ledger = env.ledger().sequence();
        let locked_until = existing_stake
            .start_ledger
            .checked_add(config.lock_period)
            .expect("Lock period overflow");
        if current_ledger < locked_until {
            return Err(PoolError::TokensLocked);
        }
        if existing_stake.amount > 0 {
            let pending = Self::calculate_reward(env.clone(), user.clone());
            if pending > 0 {
                existing_stake.reward_claimed = existing_stake
                    .reward_claimed
                    .checked_add(pending)
                    .expect("Reward overflow");
            }
        }
        existing_stake.amount = existing_stake
            .amount
            .checked_sub(amount)
            .expect("Stake underflow");
        existing_stake.start_ledger = current_ledger;
        if existing_stake.amount == 0 {
            env.storage().persistent().remove(&stake_key);
        } else {
            s::set_and_extend(&env, &stake_key, &existing_stake, TTL_REFRESH_THRESHOLD);
        }
        let total: i128 = s::get_persistent(&env, &KEY_TOTAL_STAKED, 0i128);
        let new_total = total.checked_sub(amount).expect("Total staked underflow");
        s::set_persistent(&env, &KEY_TOTAL_STAKED, &new_total);
        let token_id: Address = s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        let pool_address = env.current_contract_address();
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.transfer(&pool_address, &user, &amount);
        e::publish(&env, (e::EVENT_UNSTAKE, &user), amount);
        Ok(())
    }

    pub fn claim_reward(env: Env, user: Address) -> Result<i128, PoolError> {
        user.require_auth();
        let stake_key = StakeKey::Stake(user.clone());
        let mut existing_stake: StakeInfo =
            env.storage()
                .persistent()
                .get(&stake_key)
                .unwrap_or(StakeInfo {
                    amount: 0,
                    start_ledger: 0,
                    reward_claimed: 0,
                });
        let pending = Self::calculate_reward(env.clone(), user.clone());
        let total_reward = existing_stake
            .reward_claimed
            .checked_add(pending)
            .expect("reward total overflow");
        if total_reward <= 0 {
            return Ok(0);
        }

        // Cap reward at available pool balance (non-panicking partial payout)
        let mut reward_pool: i128 = s::get_persistent(&env, &KEY_REWARD_POOL, 0i128);
        let claimable = if reward_pool < total_reward {
            reward_pool
        } else {
            total_reward
        };
        if claimable <= 0 {
            return Ok(0);
        }

        reward_pool = reward_pool
            .checked_sub(claimable)
            .expect("Reward pool underflow");
        s::set_persistent(&env, &KEY_REWARD_POOL, &reward_pool);

        // Transfer reward tokens to user via cross-contract call
        let token_id: Address = s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        let pool_address = env.current_contract_address();
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.transfer(&pool_address, &user, &claimable);

        // Carry forward unclaimed portion if pool was insufficient
        let unclaimed = total_reward
            .checked_sub(claimable)
            .expect("Unclaimed underflow");
        existing_stake.reward_claimed = unclaimed;
        existing_stake.start_ledger = env.ledger().sequence();
        s::set_and_extend(&env, &stake_key, &existing_stake, TTL_REFRESH_THRESHOLD);

        e::publish(&env, (e::EVENT_REWARD, &user), claimable);
        Ok(claimable)
    }

    pub fn calculate_reward(env: Env, user: Address) -> i128 {
        let config: PoolConfig = s::get_persistent(
            &env,
            &KEY_POOL_CONFIG,
            PoolConfig {
                reward_rate: 0,
                min_stake: 0,
                max_stake: 0,
                lock_period: 0,
                active: false,
            },
        );
        let stake_key = StakeKey::Stake(user.clone());
        let stake: StakeInfo = env
            .storage()
            .persistent()
            .get(&stake_key)
            .unwrap_or(StakeInfo {
                amount: 0,
                start_ledger: 0,
                reward_claimed: 0,
            });
        if stake.amount == 0 || config.reward_rate == 0 {
            return 0;
        }
        let current_ledger = env.ledger().sequence();
        let elapsed = (current_ledger as i128) - (stake.start_ledger as i128);
        if elapsed <= 0 {
            return 0;
        }
        // Checked math: a malicious reward_rate/stake/elapsed combination
        // must not be able to overflow i128 and wrap to a negative reward.
        match stake
            .amount
            .checked_mul(config.reward_rate)
            .and_then(|v| v.checked_mul(elapsed))
        {
            Some(product) => product / REWARD_DIVISOR,
            None => 0,
        }
    }

    pub fn fund_rewards(env: Env, admin: Address, amount: i128) -> Result<(), PoolError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(PoolError::NotAuthorized);
        }
        if amount <= 0 {
            return Err(PoolError::InvalidParameter);
        }
        admin.require_auth();
        // Transfer reward tokens from admin to pool's token balance
        let token_id: Address = s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        let pool_address = env.current_contract_address();
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.transfer_from(&pool_address, &admin, &pool_address, &amount);
        // Update on-chain reward pool tracking
        let mut reward_pool: i128 = s::get_persistent(&env, &KEY_REWARD_POOL, 0i128);
        reward_pool = reward_pool
            .checked_add(amount)
            .expect("Reward pool overflow");
        s::set_persistent(&env, &KEY_REWARD_POOL, &reward_pool);
        e::publish(&env, (symbol_short!("rew_fund"), &admin), amount);
        Ok(())
    }

    pub fn set_reward_rate(env: Env, admin: Address, reward_rate: i128) -> Result<(), PoolError> {
        if !Self::is_admin(&env, &admin) {
            return Err(PoolError::NotAuthorized);
        }
        if reward_rate < 0 {
            return Err(PoolError::InvalidParameter);
        }
        admin.require_auth();
        let mut config: PoolConfig = s::get_persistent(
            &env,
            &KEY_POOL_CONFIG,
            PoolConfig {
                reward_rate: 0,
                min_stake: 0,
                max_stake: 0,
                lock_period: 0,
                active: false,
            },
        );
        config.reward_rate = reward_rate;
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        e::publish(&env, (symbol_short!("rew_rate"), &admin), reward_rate);
        Ok(())
    }

    pub fn set_min_stake(env: Env, admin: Address, min_stake: i128) -> Result<(), PoolError> {
        if !Self::is_admin(&env, &admin) {
            return Err(PoolError::NotAuthorized);
        }
        if min_stake < 0 {
            return Err(PoolError::InvalidParameter);
        }
        admin.require_auth();
        let mut config: PoolConfig = s::get_persistent(
            &env,
            &KEY_POOL_CONFIG,
            PoolConfig {
                reward_rate: 0,
                min_stake: 0,
                max_stake: 0,
                lock_period: 0,
                active: false,
            },
        );
        // A minimum above the configured maximum makes staking impossible;
        // reject instead of silently bricking the pool for users.
        if min_stake > config.max_stake {
            return Err(PoolError::InvalidParameter);
        }
        config.min_stake = min_stake;
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        e::publish(&env, (symbol_short!("min_stk"), &admin), min_stake);
        Ok(())
    }

    /// Set a new maximum stake. Existing stakes above the new max are not
    /// touched; only new stakes / top-ups are bounded.
    pub fn set_max_stake(env: Env, admin: Address, max_stake: i128) -> Result<(), PoolError> {
        if !Self::is_admin(&env, &admin) {
            return Err(PoolError::NotAuthorized);
        }
        if max_stake < 0 {
            return Err(PoolError::InvalidParameter);
        }
        admin.require_auth();
        let mut config: PoolConfig = s::get_persistent(
            &env,
            &KEY_POOL_CONFIG,
            PoolConfig {
                reward_rate: 0,
                min_stake: 0,
                max_stake: 0,
                lock_period: 0,
                active: false,
            },
        );
        // A maximum below the configured minimum makes staking impossible;
        // reject the inconsistent pair.
        if max_stake < config.min_stake {
            return Err(PoolError::InvalidParameter);
        }
        config.max_stake = max_stake;
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        e::publish(&env, (symbol_short!("max_stk"), &admin), max_stake);
        Ok(())
    }

    pub fn set_lock_period(env: Env, admin: Address, lock_period: u32) -> Result<(), PoolError> {
        if !Self::is_admin(&env, &admin) {
            return Err(PoolError::NotAuthorized);
        }
        admin.require_auth();
        let mut config: PoolConfig = s::get_persistent(
            &env,
            &KEY_POOL_CONFIG,
            PoolConfig {
                reward_rate: 0,
                min_stake: 0,
                max_stake: 0,
                lock_period: 0,
                active: false,
            },
        );
        config.lock_period = lock_period;
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        e::publish(&env, (symbol_short!("lock_per"), &admin), lock_period);
        Ok(())
    }

    pub fn set_active(env: Env, admin: Address, active: bool) -> Result<(), PoolError> {
        if !Self::is_admin(&env, &admin) {
            return Err(PoolError::NotAuthorized);
        }
        admin.require_auth();
        let mut config: PoolConfig = s::get_persistent(
            &env,
            &KEY_POOL_CONFIG,
            PoolConfig {
                reward_rate: 0,
                min_stake: 0,
                max_stake: 0,
                lock_period: 0,
                active: false,
            },
        );
        config.active = active;
        s::set_persistent(&env, &KEY_POOL_CONFIG, &config);
        e::publish(&env, (symbol_short!("pool_act"), &admin), active);
        Ok(())
    }

    /// Pool interface version — bump on breaking changes.
    pub fn pool_version() -> u32 {
        1
    }

    /// True when the caller is the stored admin.
    fn is_admin(env: &Env, candidate: &Address) -> bool {
        let stored_admin: Address = s::get_persistent(
            env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(env, ZERO_ADDRESS_STR)),
        );
        *candidate == stored_admin
    }

    pub fn get_stake(env: Env, user: Address) -> StakeInfo {
        let key = StakeKey::Stake(user);
        env.storage().persistent().get(&key).unwrap_or(StakeInfo {
            amount: 0,
            start_ledger: 0,
            reward_claimed: 0,
        })
    }

    pub fn get_token_id(env: Env) -> Address {
        s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        )
    }

    pub fn get_pool_config(env: Env) -> PoolConfig {
        s::get_persistent(
            &env,
            &KEY_POOL_CONFIG,
            PoolConfig {
                reward_rate: 0,
                min_stake: 0,
                max_stake: 0,
                lock_period: 0,
                active: false,
            },
        )
    }

    pub fn get_total_staked(env: Env) -> i128 {
        s::get_persistent(&env, &KEY_TOTAL_STAKED, 0i128)
    }

    /// Remaining reward-pool balance the contract can pay out. Lets frontends
    /// show pool health before users stake.
    pub fn get_reward_pool(env: Env) -> i128 {
        s::get_persistent(&env, &KEY_REWARD_POOL, 0i128)
    }
}

#[cfg(test)]
mod pool_test {
    use super::*;
    use crate::token::DripToken;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::Env;

    #[test]
    fn test_stake_and_unstake() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DripToken"),
            &String::from_str(&env, "DRIP"),
            &7u32,
        );
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
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
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

// ---- Additional tests for typed errors and admin controls ----

#[cfg(test)]
mod pool_error_test {
    use super::*;
    use crate::token::DripToken;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::Env;

    fn setup<'a>(
        env: &'a Env,
        admin: &Address,
    ) -> (DripPoolClient<'a>, token::DripTokenClient<'a>) {
        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(env, &token_id);
        token_client.initialize_token(
            admin,
            &String::from_str(env, "DripToken"),
            &String::from_str(env, "DRIP"),
            &7u32,
        );
        let contract_id = env.register(DripPool, ());
        let client = DripPoolClient::new(env, &contract_id);
        client.initialize_pool(admin, &token_id, &100i128, &10i128, &100u32);
        (client, token_client)
    }

    #[test]
    fn test_version() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let (client, _) = setup(&env, &admin);
        assert_eq!(client.pool_version(), 1u32);
    }

    #[test]
    fn test_below_min_stake_returns_error() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let (client, token_client) = setup(&env, &admin);
        token_client.mint(&admin, &user, &5000i128);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&user, &client.address, &5000i128, &exp_ledger);
        assert!(matches!(
            client.try_stake(&user, &5i128),
            Err(Ok(PoolError::BelowMinStake))
        ));
    }

    #[test]
    fn test_max_stake_enforced() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let (client, token_client) = setup(&env, &admin);
        token_client.mint(&admin, &user, &5000i128);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&user, &client.address, &5000i128, &exp_ledger);
        client.set_max_stake(&admin, &100i128);
        assert!(matches!(
            client.try_stake(&user, &200i128),
            Err(Ok(PoolError::ExceedsMaxStake))
        ));
    }

    #[test]
    fn test_min_stake_above_max_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let (client, _) = setup(&env, &admin);

        client.set_max_stake(&admin, &100i128);
        assert!(matches!(
            client.try_set_min_stake(&admin, &200i128),
            Err(Ok(PoolError::InvalidParameter))
        ));
        // Raising max first makes the same minimum valid again.
        client.set_max_stake(&admin, &300i128);
        client.set_min_stake(&admin, &200i128);
        assert_eq!(client.get_pool_config().min_stake, 200i128);
    }

    #[test]
    fn test_max_stake_below_min_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let (client, _) = setup(&env, &admin);

        assert!(matches!(
            client.try_set_max_stake(&admin, &5i128), // below min_stake 10
            Err(Ok(PoolError::InvalidParameter))
        ));
    }

    #[test]
    fn test_initialize_rejects_min_above_default_max() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_id = Address::generate(&env);
        let contract_id = env.register(DripPool, ());
        let client = DripPoolClient::new(&env, &contract_id);

        let too_high = DEFAULT_MAX_STAKE + 1i128;
        assert!(matches!(
            client.try_initialize_pool(&admin, &token_id, &100i128, &too_high, &100u32),
            Err(Ok(PoolError::InvalidParameter))
        ));
    }

    #[test]
    fn test_unauthorized_set_active() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let (client, _) = setup(&env, &admin);
        assert!(matches!(
            client.try_set_active(&attacker, &false),
            Err(Ok(PoolError::NotAuthorized))
        ));
    }

    #[test]
    fn test_reward_pool_getter_reflects_funding() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let (client, token_client) = setup(&env, &admin);
        // Give the admin spendable tokens, approve the pool, then fund it.
        token_client.mint(&admin, &admin, &5000i128);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&admin, &client.address, &5000i128, &exp_ledger);
        client.fund_rewards(&admin, &3000i128);
        assert_eq!(client.get_reward_pool(), 3000i128);
    }

    #[test]
    fn test_unstake_before_lock_expiry_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let (client, token_client) = setup(&env, &admin);
        token_client.mint(&admin, &user, &5000i128);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&user, &client.address, &5000i128, &exp_ledger);
        client.stake(&user, &500i128);

        // Immediately after staking, the lock period has not elapsed.
        assert!(matches!(
            client.try_unstake(&user, &100i128),
            Err(Ok(PoolError::TokensLocked))
        ));

        // Once the lock window passes, partial unstake is allowed.
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 101);
        client.unstake(&user, &100i128);
        assert_eq!(client.get_stake(&user).amount, 400i128);
    }

    #[test]
    fn test_claim_reward_pays_out_and_decrements_pool() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let (client, token_client) = setup(&env, &admin);

        // Fund the reward pool so there is something to pay out.
        token_client.mint(&admin, &admin, &5000i128);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&admin, &client.address, &5000i128, &exp_ledger);
        client.fund_rewards(&admin, &3000i128);
        assert_eq!(client.get_reward_pool(), 3000i128);

        token_client.mint(&admin, &user, &5000i128);
        token_client.approve(&user, &client.address, &5000i128, &exp_ledger);
        client.stake(&user, &1000i128);
        let balance_before = token_client.balance(&user);

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 200);
        let claimable = client.claim_reward(&user);
        assert!(claimable > 0);

        // The reward pool shrank by exactly the payout…
        assert_eq!(client.get_reward_pool(), 3000i128 - claimable);
        // …and the user's token balance grew by the same amount.
        assert_eq!(token_client.balance(&user), balance_before + claimable);
    }

    #[test]
    fn test_reward_claim_is_idempotent_after_full_payout() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let (client, token_client) = setup(&env, &admin);

        token_client.mint(&admin, &admin, &5000i128);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&admin, &client.address, &5000i128, &exp_ledger);
        client.fund_rewards(&admin, &3000i128);

        token_client.mint(&admin, &user, &5000i128);
        token_client.approve(&user, &client.address, &5000i128, &exp_ledger);
        client.stake(&user, &1000i128);

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 200);
        let first = client.claim_reward(&user);
        assert!(first > 0);
        let pool_after_first = client.get_reward_pool();

        // A second claim must pay out nothing further — the accrued window
        // was reset at claim time, so calling again must not mint free money
        // or double-drain the pool.
        let second = client.claim_reward(&user);
        assert_eq!(second, 0);
        assert_eq!(client.get_reward_pool(), pool_after_first);
    }

    #[test]
    fn test_fund_rewards_rejects_non_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let (client, _) = setup(&env, &admin);

        assert!(matches!(
            client.try_fund_rewards(&attacker, &1000i128),
            Err(Ok(PoolError::NotAuthorized))
        ));
    }

    #[test]
    fn test_stake_on_inactive_pool_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let (client, token_client) = setup(&env, &admin);
        token_client.mint(&admin, &user, &5000i128);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&user, &client.address, &5000i128, &exp_ledger);

        client.set_active(&admin, &false);
        assert!(matches!(
            client.try_stake(&user, &500i128),
            Err(Ok(PoolError::PoolNotActive))
        ));
    }

    #[test]
    fn test_extreme_reward_rate_does_not_overflow() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let (client, token_client) = setup(&env, &admin);
        token_client.mint(&admin, &user, &5000i128);
        let exp_ledger = env.ledger().sequence() + 9999u32;
        token_client.approve(&user, &client.address, &5000i128, &exp_ledger);

        // i128::MAX reward rate — a naive amount * rate * elapsed would
        // overflow and wrap to a negative reward.
        client.set_reward_rate(&admin, &i128::MAX);
        client.stake(&user, &1000i128);
        env.ledger().set_sequence_number(10_000);

        let reward = client.calculate_reward(&user);
        assert!(reward >= 0);
    }
    #[test]
    fn test_calculate_reward_without_stake_is_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let (client, _) = setup(&env, &admin);

        // An account that never staked must accrue nothing — a nonzero
        // reward would mint value from an empty stake.
        env.ledger().set_sequence_number(10_000);
        assert_eq!(client.calculate_reward(&user), 0);
        assert_eq!(client.claim_reward(&user), 0);
    }
}
