use crate::common::constants::{TTL_REFRESH_THRESHOLD, ZERO_ADDRESS_STR};
use crate::common::events as e;
use crate::common::storage as s;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
    Symbol, Vec,
};

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
    MetadataTooLong = 8,
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

/// Byte caps for badge metadata, bounding per-badge storage cost the way the
/// governance and counter contracts bound theirs. String::len() counts UTF-8
/// bytes, so multi-byte text is measured by its on-chain size.
const MAX_NAME_BYTES: u32 = 64;
const MAX_DESC_BYTES: u32 = 256;
const MAX_URI_BYTES: u32 = 256;

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
        s::bump_instance_ttl(&env, TTL_REFRESH_THRESHOLD);

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
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(BadgeError::NotAuthorized);
        }
        admin.require_auth();

        if !(MIN_TIER..=MAX_TIER).contains(&tier) {
            return Err(BadgeError::InvalidTier);
        }
        if name.len() > MAX_NAME_BYTES
            || description.len() > MAX_DESC_BYTES
            || image_uri.len() > MAX_URI_BYTES
        {
            return Err(BadgeError::MetadataTooLong);
        }

        let mut count: u64 = s::get_persistent(&env, &KEY_BADGE_COUNT, 0u64);
        count = count.checked_add(1).expect("Badge count overflow");
        s::set_and_extend(&env, &KEY_BADGE_COUNT, &count, TTL_REFRESH_THRESHOLD);

        let badge = Badge {
            id: count,
            name: name.clone(),
            description,
            image_uri,
            tier,
        };

        let key = (KEY_BADGE, count);
        s::set_and_extend(&env, &key, &badge, TTL_REFRESH_THRESHOLD);

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
            &env,
            &s::KEY_ADMIN,
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
        if name.len() > MAX_NAME_BYTES
            || description.len() > MAX_DESC_BYTES
            || image_uri.len() > MAX_URI_BYTES
        {
            return Err(BadgeError::MetadataTooLong);
        }

        let updated = Badge {
            name,
            description,
            image_uri,
            tier,
            ..existing
        };
        s::set_and_extend(&env, &key, &updated, TTL_REFRESH_THRESHOLD);

        e::publish(
            &env,
            (symbol_short!("bdg_updte"), &admin, badge_id),
            updated.tier,
        );
        Ok(())
    }

    /// Claim a badge for a user.
    pub fn claim_badge(env: Env, user: Address, badge_id: u64) -> Result<(), BadgeError> {
        user.require_auth();

        // The zero address can never authenticate, but guard anyway so a
        // claim can never be recorded against the burn sentinel (which would
        // permanently squat on the badge with no owner able to use it).
        if is_zero_address(&env, &user) {
            return Err(BadgeError::InvalidAddress);
        }

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
        s::set_and_extend(&env, &claim_key, &claim, TTL_REFRESH_THRESHOLD);

        e::publish(
            &env,
            (e::EVENT_BADGE_CLAIM, &user, badge_id),
            env.ledger().sequence(),
        );
        Ok(())
    }

    /// Revoke a badge from a user. Only admin.
    pub fn revoke_badge(
        env: Env,
        admin: Address,
        user: Address,
        badge_id: u64,
    ) -> Result<(), BadgeError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
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
        e::publish(
            &env,
            (symbol_short!("bdg_revke"), &admin, user, badge_id),
            env.ledger().sequence(),
        );
        Ok(())
    }

    /// List badge definitions, oldest first, with a bounded (start, limit)
    /// window so frontends can page through large badge sets without
    /// loading the whole catalog.
    pub fn list_badges(env: Env, start: u64, limit: u32) -> Vec<Badge> {
        let mut out = Vec::new(&env);
        let count: u64 = s::get_persistent(&env, &KEY_BADGE_COUNT, 0u64);
        if count == 0 || limit == 0 {
            return out;
        }
        let window = limit as u64;
        let begin = start.saturating_add(1);
        if begin > count {
            return out;
        }
        let end = begin.saturating_add(window).saturating_sub(1).min(count);
        for i in begin..=end {
            let key = (KEY_BADGE, i);
            if let Some(b) = env.storage().persistent().get::<_, Badge>(&key) {
                out.push_back(b);
            }
        }
        out
    }

    /// Check if a user has claimed a specific badge.
    pub fn has_badge(env: Env, user: Address, badge_id: u64) -> bool {
        let key = (KEY_USER_BADGES, user, badge_id);
        env.storage().persistent().has(&key)
    }

    /// Get a user's claimed badge IDs (whole set, oldest claim first).
    pub fn get_user_badges(env: Env, user: Address) -> Vec<u64> {
        let count: u64 = s::get_persistent(&env, &KEY_BADGE_COUNT, 0u64);
        Self::list_user_badges(env, user, 0, count.min(u32::MAX as u64) as u32)
    }

    /// Page through a user's claimed badge IDs, oldest claim first, with a
    /// bounded (start, limit) window so frontends can page through large
    /// badge sets without materializing the whole catalog. Mirrors the
    /// list_badges pagination contract.
    pub fn list_user_badges(env: Env, user: Address, start: u64, limit: u32) -> Vec<u64> {
        let mut out = Vec::new(&env);
        let count: u64 = s::get_persistent(&env, &KEY_BADGE_COUNT, 0u64);
        if count == 0 || limit == 0 {
            return out;
        }
        let window = limit as u64;
        let begin = start.saturating_add(1);
        if begin > count {
            return out;
        }
        let end = begin.saturating_add(window).saturating_sub(1).min(count);
        for i in begin..=end {
            let key = (KEY_USER_BADGES, user.clone(), i);
            if env.storage().persistent().has(&key) {
                out.push_back(i);
            }
        }
        out
    }

    /// Grant a badge directly (admin only, no user auth required).
    pub fn grant_badge(
        env: Env,
        admin: Address,
        user: Address,
        badge_id: u64,
    ) -> Result<(), BadgeError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(BadgeError::NotAuthorized);
        }
        admin.require_auth();

        // An admin grant needs no user auth, so a grant to the zero address
        // would otherwise succeed and permanently occupy the badge with a
        // claim nobody can use — reject it like mint-to-zero in the token.
        if is_zero_address(&env, &user) {
            return Err(BadgeError::InvalidAddress);
        }

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
        s::set_and_extend(&env, &claim_key, &claim, TTL_REFRESH_THRESHOLD);

        e::publish(
            &env,
            (e::EVENT_BADGE_CLAIM, &user, badge_id),
            env.ledger().sequence(),
        );
        Ok(())
    }

    /// Current contract version.
    pub fn badge_version(_env: Env) -> u32 {
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
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        )
    }
}

// ---- Tests ----

#[cfg(test)]
mod badge_test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
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
            &admin,
            &String::from_str(&env, "B"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, ""),
            &1u32,
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
            &admin,
            &String::from_str(&env, "R"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, ""),
            &2u32,
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
    fn test_metadata_length_bounds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);
        client.initialize_badge(&admin);

        // At the limit (64/256/256 bytes) creation succeeds…
        let id = client.create_badge(
            &admin,
            &String::from_str(&env, &"n".repeat(64)),
            &String::from_str(&env, &"d".repeat(256)),
            &String::from_str(&env, &"u".repeat(256)),
            &1u32,
        );
        assert_eq!(id, 1u64);

        // …and one byte over any cap is rejected with the typed error.
        for over in [
            ("n".repeat(65), "d".repeat(10), "u".repeat(10)),
            ("n".repeat(10), "d".repeat(257), "u".repeat(10)),
            ("n".repeat(10), "d".repeat(10), "u".repeat(257)),
        ] {
            let err = client.try_create_badge(
                &admin,
                &String::from_str(&env, &over.0),
                &String::from_str(&env, &over.1),
                &String::from_str(&env, &over.2),
                &1u32,
            );
            assert_eq!(err, Err(Ok(BadgeError::MetadataTooLong)));
        }

        // The same bounds apply on update.
        let err = client.try_update_badge(
            &admin,
            &1u64,
            &String::from_str(&env, &"x".repeat(65)),
            &String::from_str(&env, "ok"),
            &String::from_str(&env, "ok"),
            &1u32,
        );
        assert_eq!(err, Err(Ok(BadgeError::MetadataTooLong)));
    }

    #[test]
    fn test_list_user_badges_paginates() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);
        client.initialize_badge(&admin);

        for n in 1u64..=5u64 {
            client.create_badge(
                &admin,
                &String::from_str(&env, &format!("B{n}")),
                &String::from_str(&env, "D"),
                &String::from_str(&env, ""),
                &((n as u32 % 4) + 1),
            );
            client.claim_badge(&user, &n);
        }

        // Page 1: two oldest claims (1, 2).
        let page1 = client.list_user_badges(&user, &0u64, &2u32);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1.get(0).unwrap(), 1u64);
        assert_eq!(page1.get(1).unwrap(), 2u64);

        // Page 2: next two (3, 4).
        let page2 = client.list_user_badges(&user, &2u64, &2u32);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2.get(0).unwrap(), 3u64);
        assert_eq!(page2.get(1).unwrap(), 4u64);

        // Tail and bounds.
        let tail = client.list_user_badges(&user, &4u64, &10u32);
        assert_eq!(tail.len(), 1);
        assert_eq!(tail.get(0).unwrap(), 5u64);
        let empty = client.list_user_badges(&user, &5u64, &10u32);
        assert_eq!(empty.len(), 0);

        // The compatibility getter still returns the full set.
        assert_eq!(client.get_user_badges(&user).len(), 5u32);
    }

    #[test]
    fn test_admin_gates() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);
        client.initialize_badge(&admin);
        client.create_badge(
            &admin,
            &String::from_str(&env, "G"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, ""),
            &2u32,
        );

        // Non-admin cannot grant badges.
        let err = client.try_grant_badge(&stranger, &user, &1);
        assert_eq!(err, Err(Ok(BadgeError::NotAuthorized)));

        // Updating a missing badge reports NotFound, not a silent success.
        let err = client.try_update_badge(
            &admin,
            &99u64,
            &String::from_str(&env, "X"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, ""),
            &1u32,
        );
        assert_eq!(err, Err(Ok(BadgeError::BadgeNotFound)));

        // The tier range is enforced on update just like creation.
        let err = client.try_update_badge(
            &admin,
            &1u64,
            &String::from_str(&env, "X"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, ""),
            &9u32,
        );
        assert_eq!(err, Err(Ok(BadgeError::InvalidTier)));
    }

    #[test]
    fn test_update_badge_persists_metadata() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);
        client.initialize_badge(&admin);
        client.create_badge(
            &admin,
            &String::from_str(&env, "G"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, ""),
            &2u32,
        );

        // Success path: the updated name/description/uri/tier must actually
        // persist (existing tests only covered update error paths).
        client.update_badge(
            &admin,
            &1u64,
            &String::from_str(&env, "Gold Dripper"),
            &String::from_str(&env, "Awarded for 100 drips"),
            &String::from_str(&env, "https://example.com/gold.png"),
            &4u32,
        );

        let badge = client.get_badge(&1u64).unwrap();
        assert_eq!(badge.name, String::from_str(&env, "Gold Dripper"));
        assert_eq!(
            badge.description,
            String::from_str(&env, "Awarded for 100 drips")
        );
        assert_eq!(
            badge.image_uri,
            String::from_str(&env, "https://example.com/gold.png")
        );
        assert_eq!(badge.tier, 4u32);
        // id is preserved across the update
        assert_eq!(badge.id, 1u64);
    }

    #[test]
    fn test_revoked_badge_can_be_reclaimed() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);
        client.initialize_badge(&admin);
        client.create_badge(
            &admin,
            &String::from_str(&env, "G"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, ""),
            &1u32,
        );

        client.claim_badge(&user, &1u64);
        assert!(client.has_badge(&user, &1u64));

        // Revocation removes the claim entirely (not just marks it dead), so
        // the user can legitimately earn the badge again later.
        client.revoke_badge(&admin, &user, &1u64);
        assert!(!client.has_badge(&user, &1u64));

        client.claim_badge(&user, &1u64);
        assert!(client.has_badge(&user, &1u64));
    }

    /// Granting (or claiming) a badge for the zero address would permanently
    /// occupy the badge with a claim nobody can ever use.
    #[test]
    fn test_zero_address_claims_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR));
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);
        client.initialize_badge(&admin);
        client.create_badge(
            &admin,
            &String::from_str(&env, "G"),
            &String::from_str(&env, "D"),
            &String::from_str(&env, ""),
            &1u32,
        );

        // An admin grant to the zero address is refused…
        let err = client.try_grant_badge(&admin, &zero, &1u64);
        assert_eq!(err, Err(Ok(BadgeError::InvalidAddress)));
        assert!(!client.has_badge(&zero, &1u64));

        // …and so is a claim from it.
        let err = client.try_claim_badge(&zero, &1u64);
        assert_eq!(err, Err(Ok(BadgeError::InvalidAddress)));
        assert!(!client.has_badge(&zero, &1u64));

        // A real user is unaffected.
        let user = Address::generate(&env);
        client.claim_badge(&user, &1u64);
        assert!(client.has_badge(&user, &1u64));
    }

    #[test]
    fn test_initialize_guards() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let zero = Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR));
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);

        // The zero address cannot become admin.
        let err = client.try_initialize_badge(&zero);
        assert_eq!(err, Err(Ok(BadgeError::InvalidAddress)));

        client.initialize_badge(&admin);

        // A second initialization is refused — the admin slot is already set.
        let err = client.try_initialize_badge(&admin);
        assert_eq!(err, Err(Ok(BadgeError::AlreadyInitialized)));
    }

    #[test]
    fn test_version() {
        let env = Env::default();
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);
        assert_eq!(client.badge_version(), 1u32);
    }

    #[test]
    fn test_list_badges_paginates() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(DripBadge, ());
        let client = DripBadgeClient::new(&env, &contract_id);
        client.initialize_badge(&admin);

        for n in 1u64..=4u64 {
            client.create_badge(
                &admin,
                &String::from_str(&env, &format!("B{n}")),
                &String::from_str(&env, "D"),
                &String::from_str(&env, ""),
                &((n as u32 % 4) + 1),
            );
        }
        assert_eq!(client.get_badge_count(), 4u64);

        let page1 = client.list_badges(&0u64, &2u32);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1.get(0).unwrap().id, 1u64);
        assert_eq!(page1.get(1).unwrap().id, 2u64);

        let page2 = client.list_badges(&2u64, &2u32);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2.get(0).unwrap().id, 3u64);
        assert_eq!(page2.get(1).unwrap().id, 4u64);

        let past_end = client.list_badges(&4u64, &5u32);
        assert_eq!(past_end.len(), 0);
    }
}
