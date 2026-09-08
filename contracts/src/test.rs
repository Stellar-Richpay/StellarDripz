#![cfg(test)]

// Integration tests for the Counter contract.
// Token, Pool, Governance, and Badge tests live in their respective modules.
// The duplicate token tests that previously existed here were removed (C2/T2)
// — they are maintained in src/token/mod.rs, src/pool/mod.rs, etc.

mod counter_test {
    use crate::counter::{StellarDripzCounter, StellarDripzCounterClient};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String};

    #[test]
    fn test_counter_increment() {
        let env = Env::default();
        let user = Address::generate(&env);
        env.mock_all_auths();

        let contract_id = env.register(StellarDripzCounter, ());
        let client = StellarDripzCounterClient::new(&env, &contract_id);

        assert_eq!(client.get_global(), 0);
        assert_eq!(client.increment(&user), 1);
        assert_eq!(client.get_global(), 1);
        assert_eq!(client.increment(&user), 2);
        assert_eq!(client.get_global(), 2);
    }

    #[test]
    fn test_greeting() {
        let env = Env::default();
        let user = Address::generate(&env);
        env.mock_all_auths();

        let contract_id = env.register(StellarDripzCounter, ());
        let client = StellarDripzCounterClient::new(&env, &contract_id);

        assert_eq!(
            client.get_greeting(&user),
            String::from_str(&env, "Hello from StellarDripz!")
        );

        let msg = String::from_str(&env, "Drip it!");
        client.set_greeting(&user, &msg);
        assert_eq!(client.get_greeting(&user), msg);
    }

    #[test]
    fn test_greeting_is_per_user() {
        let env = Env::default();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        env.mock_all_auths();

        let contract_id = env.register(StellarDripzCounter, ());
        let client = StellarDripzCounterClient::new(&env, &contract_id);

        let alice_msg = String::from_str(&env, "Alice here");
        let bob_msg = String::from_str(&env, "Bob here");
        client.set_greeting(&alice, &alice_msg);
        client.set_greeting(&bob, &bob_msg);

        assert_eq!(client.get_greeting(&alice), alice_msg);
        assert_eq!(client.get_greeting(&bob), bob_msg);
    }

    #[test]
    fn test_greeting_too_long_rejected() {
        let env = Env::default();
        let user = Address::generate(&env);
        env.mock_all_auths();

        let contract_id = env.register(StellarDripzCounter, ());
        let client = StellarDripzCounterClient::new(&env, &contract_id);

        let long = String::from_str(&env, &"x".repeat(600));
        let err = client.try_set_greeting(&user, &long);
        assert!(err.is_err());
    }

    #[test]
    fn test_greeting_size_boundary_is_byte_exact() {
        let env = Env::default();
        let user = Address::generate(&env);
        env.mock_all_auths();

        let contract_id = env.register(StellarDripzCounter, ());
        let client = StellarDripzCounterClient::new(&env, &contract_id);

        // String::len() is a byte count, so exactly 512 ASCII bytes is the
        // limit and must be accepted…
        let at_limit = String::from_str(&env, &"x".repeat(512));
        client.set_greeting(&user, &at_limit);
        assert_eq!(client.get_greeting(&user), at_limit);

        // …and one more byte must be rejected with the typed error.
        let over_limit = String::from_str(&env, &"x".repeat(513));
        let err = client.try_set_greeting(&user, &over_limit);
        assert_eq!(err, Err(Ok(crate::counter::CounterError::GreetingTooLong)));

        // Multi-byte UTF-8 counts by encoded size too: 256 é (512 bytes) is
        // accepted while 257 é (514 bytes) is not.
        let multi_at_limit = String::from_str(&env, &"é".repeat(256));
        client.set_greeting(&user, &multi_at_limit);
        assert_eq!(client.get_greeting(&user), multi_at_limit);
        let multi_over = String::from_str(&env, &"é".repeat(257));
        let err = client.try_set_greeting(&user, &multi_over);
        assert_eq!(err, Err(Ok(crate::counter::CounterError::GreetingTooLong)));
    }

    #[test]
    fn test_reset_clears_user_state() {
        let env = Env::default();
        let user = Address::generate(&env);
        env.mock_all_auths();

        let contract_id = env.register(StellarDripzCounter, ());
        let client = StellarDripzCounterClient::new(&env, &contract_id);

        client.increment(&user);
        client.set_greeting(&user, &String::from_str(&env, "hi"));

        client.reset(&user);
        assert_eq!(client.get_user(&user), 0);
        assert_eq!(
            client.get_greeting(&user),
            String::from_str(&env, "Hello from StellarDripz!")
        );
    }

    #[test]
    fn test_counter_version() {
        let env = Env::default();
        let contract_id = env.register(StellarDripzCounter, ());
        let client = StellarDripzCounterClient::new(&env, &contract_id);
        assert_eq!(client.counter_version(), 1u32);
    }

    #[test]
    fn test_user_counter_independent() {
        let env = Env::default();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        env.mock_all_auths();

        let contract_id = env.register(StellarDripzCounter, ());
        let client = StellarDripzCounterClient::new(&env, &contract_id);

        assert_eq!(client.get_global(), 0);

        // Alice increments
        assert_eq!(client.increment(&alice), 1);
        assert_eq!(client.get_global(), 1);

        // Bob increments
        assert_eq!(client.increment(&bob), 2);
        assert_eq!(client.get_global(), 2);
    }
}
