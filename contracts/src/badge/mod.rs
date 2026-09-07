use soroban_sdk::{contract, contractimpl, contracterror, contracttype, Address, Env, String, Symbol, symbol_short, Vec};
use crate::common::storage as s;
use crate::common::events as e;
use crate::common::constants::ZERO_ADDRESS_STR;

// ---- Contract Errors ----

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum BadgeError {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    BadgeNotFound = 3,
    AlreadyClaimed = 4,
    InvalidTier = 5,
    InvalidAddress = 6,
    NotClaimed = 7,
}

// ---- Data Types ----

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Badge {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub image_uri: String,
    pub tier: u32, // 1=Bronze, 2=Silver, 3=Gold, 4=Platinum
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BadgeClaim {
    pub badge_id: u64,
    pub claimed_ledger: u32,
}

// ---- Storage Keys ----

const KEY_BADGE_COUNT: Symbol = symbol_short!("BADGE_CT");
const KEY_BADGE: Symbol = symbol_short!("BADGE");
const KEY_USER_BADGES: Symbol = symbol_short!("USR_BADG");

/// Contract version, bumped on breaking changes.
const CONTRACT_VERSION: u32 = 1;

const MIN_TIER: u32 = 1;
const MAX_TIER: u32 = 4;

fn is_zero_address(env: &Env, addr: &Address) -> bool {
    addr.to_string() == String::from_str(env, ZERO_ADDRESS_STR)
}

#[contract]
pub struct DripBadge;

// ---- Implementation ----

#[contractimpl]
impl DripBadge {
    /// Initialize. Only admin.
    pub fn initialize_badge(env: Env, admin: Address) -> Result<(), BadgeError> {
        if env.storage().persistent().has(&s::KEY_ADMIN) {
            return Err(BadgeError::AlreadyInitialized);
        }
        if is_zero_address(&env, &admin) {
            return Err(BadgeError::InvalidAddress);
        }
        admin.require_auth();

        s::set_persistent(&env, &s::KEY_ADMIN, &admin);
        s::set_persistent(&env, &KEY_BADGE_COUNT, &0u64);

        e::publish(&env, (symbol_short!("bdg_init"), &admin), 0u64);
        Ok(())
    }

    /// Create a new badge definition. Only admin.
    pub fn create_badge(
        env: Env,
        admin: Address,
        name: String,
        description: String,
        image_uri: String,
        tier: u32,
    ) -> Result<u64, BadgeError> {
        let stored_admin: Address = s::get_persistent(
            &env, &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(BadgeError::NotAuthorized);
        }
        admin.require_auth();

        if !(MIN_TIER..=MAX_TIER).contains(&tier) {
            return Err(BadgeError::InvalidTier);
        }

        let mut count: u64 = s::get_persistent(&env, &KEY_BADGE_COUNT, 0u64);
        count += 1;
        s::set_persistent(&env, &KEY_BADGE_COUNT, &count);

        let badge = Badge {
            id: count,
            name: name.clone(),
            description,
            image_uri,
            tier,
        };

        let key = (KEY_BADGE, count);
        env.storage().persistent().set(&key, &badge);

        e::publish(&env, (symbol_short!("bdg_creat"), &admin, count), name);
        Ok(count)
    }

    /// Update a badge's metadata. Only admin.
    pub fn update_badge(
        env: Env,
        admin: Address,
        badge_id: u64,
        name: String,
        description: String,
        image_uri: String,
        tier: u32,
    ) -> Result<(), BadgeError> {
        let stored_admin: Address = s::get_persistent(
            &env, &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(BadgeError::NotAuthorized);
        }
        admin.require_auth();

        let key = (KEY_BADGE, badge_id);
        let existing: Badge = match env.storage().persistent().get(&key) {
            Some(b) => b,
            None => return Err(BadgeError::BadgeNotFound),
        };

        if !(MIN_TIER..=MAX_TIER).contains(&tier) {
            return Err(BadgeError::InvalidTier);
        }

        let updated = Badge {
            name,
            description,
            image_uri,
            tier,
            ..existing
        };
        env.storage().persistent().set(&key, &updated);

        e::publish(&env, (symbol_short!("bdg_updte"), &admin, badge_id), updated.tier);
        Ok(())
    }

    /// Claim a badge for a user.
    pub fn claim_badge(env: Env, user: Address, badge_id: u64) -> Result<(), BadgeError> {
        user.require_auth();

        // Check badge exists
        let badge_key = (KEY_BADGE, badge_id);
        if !env.storage().persistent().has(&badge_key) {
            return Err(BadgeError::BadgeNotFound);
        }

        // Check not already claimed
        let claim_key = (KEY_USER_BADGES, user.clone(), badge_id);
        if env.storage().persistent().has(&claim_key) {
            return Err(BadgeError::AlreadyClaimed);
        }

        let claim = BadgeClaim {
            badge_id,
            claimed_ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set(&claim_key, &claim);

        e::publish(&env, (e::EVENT_BADGE_CLAIM, &user, badge_id), env.ledger().sequence());
        Ok(())
    }

    /// Revoke a badge from a user. Only admin.
    pub fn revoke_badge(env: Env, admin: Address, user: Address, badge_id: u64) -> Result<(), BadgeError> {
        let stored_admin: Address = s::get_persistent(
            &env, &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(BadgeError::NotAuthorized);
        }
        admin.require_auth();

        let claim_key = (KEY_USER_BADGES, user.clone(), badge_id);
        if !env.storage().persistent().has(&claim_key) {
            return Err(BadgeError::NotClaimed);
        }

        env.storage().persistent().remove(&claim_key);
        e::publish(&env, (symbol_short!("bdg_revke"), &admin, user, badge_id), env.ledger().sequence());
        Ok(())
    }

    /// Check if a user has claimed a specific badge.
    pub fn has_badge(env: Env, user: Address, badge_id: u64) -> bool {
        let key = (KEY_USER_BADGES, user, badge_id);
        env.storage().persistent().has(&key)
    }

    /// Get a user's claimed badge IDs.
    ///
    /// NOTE: This iterates through all badges (O(n)). For production use
    /// with large badge counts, consider adding pagination parameters
    /// (offset/limit) or an index of user→badge mappings.
    pub fn get_user_badges(env: Env, user: Address) -> Vec<u64> {
        let mut badges = Vec::new(&env);
        let count: u64 = s::get_persistent(&env, &KEY_BADGE_COUNT, 0u64);

        for i in 1..=count {
            let key = (KEY_USER_BADGES, user.clone(), i);
            if env.storage().persistent().has(&key) {
                badges.push_back(i);
            }
        }
        badges
    }

    /// Grant a badge directly (admin only, no user auth required).
    pub fn grant_badge(env: Env, admin: Address, user: Address, badge_id: u64) -> Result<(), BadgeError> {
        let stored_admin: Address = s::get_persistent(
            &env, &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(BadgeError::NotAuthorized);
        }
        admin.require_auth();

        let badge_key = (KEY_BADGE, badge_id);
        if !env.storage().persistent().has(&badge_key) {
            return Err(BadgeError::BadgeNotFound);
        }

        let claim_key = (KEY_USER_BADGES, user.clone(), badge_id);
        if env.storage().persistent().has(&claim_key) {
            return Err(BadgeError::AlreadyClaimed);
        }

        let claim = BadgeClaim {
            badge_id,
            claimed_ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set(&claim_key, &claim);

        e::publish(&env, (e::EVENT_BADGE_CLAIM, &user, badge_id), env.ledger().sequence());
        Ok(())
    }

    /// Current contract version.
    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    // ---- Getters ----

    pub fn get_badge(env: Env, badge_id: u64) -> Option<Badge> {
        let key = (KEY_BADGE, badge_id);
        env.storage().persistent().get(&key)
    }

    pub fn get_badge_count(env: Env) -> u64 {
        s::get_persistent(&env, &KEY_BADGE_COUNT, 0u64)
    }

    pub fn get_claim(env: Env, user: Address, badge_id: u64) -> Option<BadgeClaim> {
        let key = (KEY_USER_BADGES, user, badge_id);
        env.storage().persistent().get(&key)
    }

    pub fn get_admin(env: Env) -> Address {
        s::get_persistent(
            &env, &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        )
    }
}

// ---- Tests ----

#[cfg(test)]
mod badge_test {
    use soroban_sdk::testutils::Address as _;
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_create_and_claim_badge() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);

        client.initialize_badge(&admin);

        // Create badge
        let id = client.create_badge(
            &admin,
            &String::from_str(&env, "Early Dripper"),
            &String::from_str(&env, "First 100 users"),
            &String::from_str(&env, "ipfs://badge1"),
            &3u32,
        );
        assert_eq!(id, 1);

        let badge = client.get_badge(&1).unwrap();
        assert_eq!(badge.name, String::from_str(&env, "Early Dripper"));
        assert_eq!(badge.tier, 3u32);

        // Claim
        client.claim_badge(&user, &1);
        assert!(client.has_badge(&user, &1));
        assert!(!client.has_badge(&user, &2));
    }

    #[test]
    fn test_grant_badge() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);

        client.initialize_badge(&admin);

        client.create_badge(
            &admin,
            &String::from_str(&env, "OG"),
            &String::from_str(&env, "Original Gangster"),
            &String::from_str(&env, "ipfs://og"),
            &4u32,
        );

        client.grant_badge(&admin, &user, &1);

        assert!(client.has_badge(&user, &1));

        let user_badges = client.get_user_badges(&user);
        assert_eq!(user_badges.len(), 1);
    }

    #[test]
    fn test_duplicate_claim_prevented() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);

        client.initialize_badge(&admin);
        client.create_badge(
            &admin, &String::from_str(&env, "B"), &String::from_str(&env, "D"), &String::from_str(&env, ""), &1u32,
        );

        client.claim_badge(&user, &1);

        // Second claim should error
        let err = client.try_claim_badge(&user, &1);
        assert_eq!(err, Err(Ok(BadgeError::AlreadyClaimed)));
    }

    #[test]
    fn test_claim_nonexistent_badge_errors() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);

        client.initialize_badge(&admin);

        let err = client.try_claim_badge(&user, &99);
        assert_eq!(err, Err(Ok(BadgeError::BadgeNotFound)));
    }

    #[test]
    fn test_invalid_tier_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);

        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);

        client.initialize_badge(&admin);

        let err = client.try_create_badge(
            &admin,
            &String::from_str(&env, "Bogus"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, ""),
            &9u32,
        );
        assert_eq!(err, Err(Ok(BadgeError::InvalidTier)));
    }

    #[test]
    fn test_revoke_badge() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);

        client.initialize_badge(&admin);
        client.create_badge(
            &admin, &String::from_str(&env, "R"), &String::from_str(&env, "D"), &String::from_str(&env, ""), &2u32,
        );

        client.claim_badge(&user, &1);
        assert!(client.has_badge(&user, &1));

        // Non-admin cannot revoke
        let err = client.try_revoke_badge(&user, &user, &1);
        assert_eq!(err, Err(Ok(BadgeError::NotAuthorized)));

        client.revoke_badge(&admin, &user, &1);
        assert!(!client.has_badge(&user, &1));

        // Revoking again errors
        let err = client.try_revoke_badge(&admin, &user, &1);
        assert_eq!(err, Err(Ok(BadgeError::NotClaimed)));
    }

    #[test]
    fn test_version() {
        let env = Env::default();
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);
        assert_eq!(client.version(), 1u32);
    }
}