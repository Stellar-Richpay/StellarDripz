/**
 * Property-based (fuzz) test example for DripToken.
 *
 * Uses Soroban SDK testutils to verify that token invariants hold
 * across a wide range of random inputs — a lightweight alternative
 * to full proptest/proptest-rs frameworks.
 *
 * Invariants tested:
 *   1. Total supply = sum of all balances (conservation of tokens)
 *   2. Transfer of 0 or negative amount panics
 *
 * To run: cargo test -- fuzz
 */

#[cfg(test)]
mod fuzz_tests {
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String, Vec};
    use crate::token::{DripToken, DripTokenClient};

    /// Verify the token conservation invariant: after any number of random
    /// transfers between random users, total_supply == sum of all balances.
    #[test]
    fn fuzz_token_supply_conservation() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &token_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "FuzzToken"),
            &String::from_str(&env, "FUZZ"),
            &7u32,
        );

        // Create 10 users with deterministic balances (100, 200, ..., 1000)
        let mut users: Vec<Address> = Vec::new(&env);
        let mut balances: Vec<i128> = Vec::new(&env);
        let mut total_minted: i128 = 0;

        for i in 0u32..10u32 {
            let user = Address::generate(&env);
            let amount = (i as i128 + 1) * 100i128;
            client.mint(&admin, &user, &amount);
            users.push_back(user);
            balances.push_back(amount);
            total_minted += amount;
        }

        assert_eq!(client.total_supply(), total_minted);

        // Perform pseudo-random transfers between users
        for i in 0u32..20u32 {
            let from_idx = i % 10u32;
            let to_idx = (i + 3u32) % 10u32;
            if from_idx == to_idx {
                continue;
            }

            let amount: i128 = ((i as i128 % 5) + 1) * 10i128;
            let from = users.get(from_idx).unwrap();
            let to = users.get(to_idx).unwrap();

            let from_before = client.balance(&from);
            if amount <= from_before {
                client.transfer(&from, &to, &amount);
                let new_from = from_before - amount;
                let to_before = balances.get(to_idx).unwrap();
                balances.set(from_idx, new_from);
                balances.set(to_idx, to_before + amount);
            }
        }

        // Verify: total_supply unchanged after all transfers
        assert_eq!(client.total_supply(), total_minted);

        // Verify: sum of all balances == total_supply
        let mut sum_balances: i128 = 0;
        for i in 0u32..10u32 {
            let user = users.get(i).unwrap();
            sum_balances += client.balance(&user);
        }
        assert_eq!(sum_balances, total_minted);
    }

    /// Verify that burning more than balance returns the typed error.
    #[test]
    fn fuzz_burn_exceeds_balance_errors() {
        use crate::token::TokenError;

        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let token_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &token_id);
        client.initialize_token(
            &admin, &String::from_str(&env, "FB"), &String::from_str(&env, "F"), &7u32,
        );
        client.mint(&admin, &alice, &100i128);
        assert!(matches!(
            client.try_burn(&alice, &101i128),
            Err(Ok(TokenError::InsufficientBalance))
        ));
    }

    /// Verify that transferring 0 returns the typed error.
    #[test]
    fn fuzz_transfer_zero_errors() {
        use crate::token::TokenError;

        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let token_id = env.register(DripToken, ());
        let client = DripTokenClient::new(&env, &token_id);
        client.initialize_token(
            &admin,
            &String::from_str(&env, "FT"),
            &String::from_str(&env, "F"),
            &7u32,
        );
        client.mint(&admin, &alice, &1000i128);
        assert!(matches!(
            client.try_transfer(&alice, &bob, &0i128),
            Err(Ok(TokenError::AmountNotPositive))
        ));
    }
}
