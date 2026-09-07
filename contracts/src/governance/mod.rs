use crate::common::constants::{TTL_REFRESH_THRESHOLD, ZERO_ADDRESS_STR};
use crate::common::events as e;
use crate::common::storage as s;
use crate::pool;
use crate::token;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, Address, Env,
    String, Symbol, Vec,
};

// ---- Contract Errors ----

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GovError {
    AlreadyInitialized = 1,
    ProposalNotFound = 2,
    VotingEnded = 3,
    AlreadyExecuted = 4,
    VotingActive = 5,
    AlreadyVoted = 6,
    NoVotingPower = 7,
    InsufficientPower = 8,
    NotAuthorized = 9,
    InvalidParameter = 10,
    InvalidVoteTotal = 11,
    QuorumNotMet = 12,
    QuorumTooHigh = 13,
}

// ---- Contract Events (SDK 27 pattern) ----

#[contractevent]
pub struct ProposalCreatedEvent {
    pub proposal_id: u64,
    pub proposer: Address,
    pub title: String,
}

#[contractevent]
pub struct VoteCastEvent {
    pub proposal_id: u64,
    pub voter: Address,
    pub power: i128,
}

// ---- Data Types ----

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub for_votes: i128,
    pub against_votes: i128,
    pub abstain_votes: i128,
    pub created_ledger: u32,
    pub voting_end: u32,
    pub executed: bool,
    pub passed: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VoteRecord {
    pub proposal_id: u64,
    pub vote: VoteChoice,
    pub power: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum VoteChoice {
    For = 0,
    Against = 1,
    Abstain = 2,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum GovernanceAction {
    SetRewardRate(i128),
    SetMinStake(i128),
    SetMaxStake(i128),
    SetLockPeriod(u32),
    SetActive(bool),
    MintTokens(Address, i128),
}

// ---- Storage Keys ----

const KEY_PROPOSAL_COUNT: Symbol = symbol_short!("PROP_CT");
const KEY_PROPOSAL: Symbol = symbol_short!("PROP");
const KEY_VOTES: Symbol = symbol_short!("VOTES");
const KEY_TOKEN_ID: Symbol = symbol_short!("TOK_ID");
const KEY_POOL_ID: Symbol = symbol_short!("POOL_ID");
const KEY_VOTING_PERIOD: Symbol = symbol_short!("VOT_PER");
const KEY_MIN_POWER: Symbol = symbol_short!("MIN_POW");
const KEY_QUORUM_BPS: Symbol = symbol_short!("QUORUM");

/// Titles longer than this are rejected to bound storage usage per proposal.
const MAX_TITLE_BYTES: u32 = 256;
/// Descriptions longer than this are rejected to bound storage usage.
const MAX_DESC_BYTES: u32 = 4096;

/// Quorum is expressed in basis points (1/10000) of the total token supply
/// that must participate for a proposal to be executable. 0 disables quorum.
const MAX_QUORUM_BPS: u32 = 10_000;

#[contract]
pub struct DripGovernance;

// ---- Implementation ----

#[contractimpl]
impl DripGovernance {
    /// Initialize governance with token and pool contract references.
    pub fn initialize_governance(
        env: Env,
        admin: Address,
        token_contract_id: Address,
        pool_contract_id: Address,
        voting_period: u32,
        min_voting_power: i128,
    ) -> Result<(), GovError> {
        if env.storage().persistent().has(&s::KEY_ADMIN) {
            return Err(GovError::AlreadyInitialized);
        }
        if voting_period == 0 {
            return Err(GovError::InvalidParameter);
        }
        if min_voting_power < 0 {
            return Err(GovError::InvalidParameter);
        }
        if admin.to_string() == String::from_str(&env, ZERO_ADDRESS_STR)
            || token_contract_id.to_string() == String::from_str(&env, ZERO_ADDRESS_STR)
            || pool_contract_id.to_string() == String::from_str(&env, ZERO_ADDRESS_STR)
        {
            return Err(GovError::InvalidParameter);
        }
        admin.require_auth();

        s::set_persistent(&env, &s::KEY_ADMIN, &admin);
        s::set_persistent(&env, &KEY_TOKEN_ID, &token_contract_id);
        s::set_persistent(&env, &KEY_POOL_ID, &pool_contract_id);
        s::set_persistent(&env, &KEY_VOTING_PERIOD, &voting_period);
        s::set_persistent(&env, &KEY_MIN_POWER, &min_voting_power);
        s::set_persistent(&env, &KEY_QUORUM_BPS, &0u32);
        s::set_persistent(&env, &KEY_PROPOSAL_COUNT, &0u64);
        s::bump_instance_ttl(&env, TTL_REFRESH_THRESHOLD);

        e::publish(&env, (symbol_short!("gov_init"), &admin), voting_period);
        Ok(())
    }

    /// Create a new proposal. Requires minimum voting power.
    pub fn propose(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        action: GovernanceAction,
    ) -> Result<u64, GovError> {
        proposer.require_auth();

        if title.is_empty() {
            return Err(GovError::InvalidParameter);
        }
        if title.len() > MAX_TITLE_BYTES || description.len() > MAX_DESC_BYTES {
            return Err(GovError::InvalidParameter);
        }

        let token_id: Address = s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );

        // --- CROSS-CONTRACT CALL: Query token balance for voting power ---
        let voting_power = Self::get_voting_power_internal(&env, &proposer, &token_id);

        let min_power: i128 = s::get_persistent(&env, &KEY_MIN_POWER, 0i128);
        if voting_power < min_power {
            return Err(GovError::InsufficientPower);
        }
        // --- END CROSS-CONTRACT CALL ---

        let mut count: u64 = s::get_persistent(&env, &KEY_PROPOSAL_COUNT, 0u64);
        count = count.checked_add(1).expect("Proposal count overflow");
        s::set_persistent(&env, &KEY_PROPOSAL_COUNT, &count);

        let current_ledger = env.ledger().sequence();
        let voting_period: u32 = s::get_persistent(&env, &KEY_VOTING_PERIOD, 100u32);
        let voting_end = current_ledger
            .checked_add(voting_period)
            .expect("Voting end overflow");

        let proposal = Proposal {
            id: count,
            proposer: proposer.clone(),
            title: title.clone(),
            description,
            for_votes: 0,
            against_votes: 0,
            abstain_votes: 0,
            created_ledger: current_ledger,
            voting_end,
            executed: false,
            passed: false,
        };

        // Store the governance action with the proposal
        let action_key = (KEY_PROPOSAL, symbol_short!("action"), count);
        s::set_and_extend(&env, &action_key, &action, TTL_REFRESH_THRESHOLD);

        let key = (KEY_PROPOSAL, count);
        s::set_and_extend(&env, &key, &proposal, TTL_REFRESH_THRESHOLD);

        e::publish(&env, (e::EVENT_PROPOSE, &proposer, count), title);
        Ok(count)
    }

    /// Vote on a proposal. Voting power = token balance via cross-contract call.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        choice: VoteChoice,
    ) -> Result<(), GovError> {
        voter.require_auth();

        let key = (KEY_PROPOSAL, proposal_id);
        let mut proposal: Proposal = match env.storage().persistent().get(&key) {
            Some(p) => p,
            None => return Err(GovError::ProposalNotFound),
        };

        if env.ledger().sequence() > proposal.voting_end {
            return Err(GovError::VotingEnded);
        }
        if proposal.executed {
            return Err(GovError::AlreadyExecuted);
        }

        // Check for duplicate vote
        let vote_key = (KEY_VOTES, proposal_id, voter.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(GovError::AlreadyVoted);
        }

        // --- CROSS-CONTRACT CALL: Get voting power from token balance ---
        let token_id: Address = s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        let power = Self::get_voting_power_internal(&env, &voter, &token_id);
        // --- END CROSS-CONTRACT CALL ---

        if power <= 0 {
            return Err(GovError::NoVotingPower);
        }

        match choice {
            VoteChoice::For => {
                proposal.for_votes = proposal
                    .for_votes
                    .checked_add(power)
                    .expect("Vote overflow")
            }
            VoteChoice::Against => {
                proposal.against_votes = proposal
                    .against_votes
                    .checked_add(power)
                    .expect("Vote overflow")
            }
            VoteChoice::Abstain => {
                proposal.abstain_votes = proposal
                    .abstain_votes
                    .checked_add(power)
                    .expect("Vote overflow")
            }
        }

        let vote_record = VoteRecord {
            proposal_id,
            vote: choice,
            power,
        };
        s::set_and_extend(&env, &vote_key, &vote_record, TTL_REFRESH_THRESHOLD);
        s::set_and_extend(&env, &key, &proposal, TTL_REFRESH_THRESHOLD);

        e::publish(&env, (e::EVENT_VOTE, &voter, proposal_id), power);
        Ok(())
    }

    /// Cancel a proposal before voting ends. Only the proposer may cancel.
    pub fn cancel_proposal(env: Env, caller: Address, proposal_id: u64) -> Result<(), GovError> {
        caller.require_auth();

        let key = (KEY_PROPOSAL, proposal_id);
        let proposal: Proposal = match env.storage().persistent().get(&key) {
            Some(p) => p,
            None => return Err(GovError::ProposalNotFound),
        };

        if proposal.proposer != caller {
            return Err(GovError::NotAuthorized);
        }
        if env.ledger().sequence() > proposal.voting_end {
            return Err(GovError::VotingEnded);
        }
        if proposal.executed {
            return Err(GovError::AlreadyExecuted);
        }

        // Mark as executed-and-failed so it can never be executed later, and
        // drop the stored action.
        let cancelled = Proposal {
            executed: true,
            passed: false,
            ..proposal
        };
        s::set_and_extend(&env, &key, &cancelled, TTL_REFRESH_THRESHOLD);
        env.storage()
            .persistent()
            .remove(&(KEY_PROPOSAL, symbol_short!("action"), proposal_id));

        e::publish(&env, (symbol_short!("cancel"), &caller, proposal_id), true);
        Ok(())
    }

    /// Execute a passed proposal by applying the governance action on-chain.
    pub fn execute(env: Env, executor: Address, proposal_id: u64) -> Result<(), GovError> {
        executor.require_auth();

        let key = (KEY_PROPOSAL, proposal_id);
        let mut proposal: Proposal = match env.storage().persistent().get(&key) {
            Some(p) => p,
            None => return Err(GovError::ProposalNotFound),
        };

        if proposal.executed {
            return Err(GovError::AlreadyExecuted);
        }
        if env.ledger().sequence() <= proposal.voting_end {
            return Err(GovError::VotingActive);
        }

        // Flash-loan sanity check: total votes cast must not exceed the
        // token supply. If it does, the votes could not have come from
        // genuinely held balances at any single point in time.
        let token_id: Address = s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        let token_client = token::DripTokenClient::new(&env, &token_id);
        let total_supply = token_client.total_supply();
        let total_votes = proposal
            .for_votes
            .checked_add(proposal.against_votes)
            .and_then(|v| v.checked_add(proposal.abstain_votes))
            .unwrap_or(i128::MAX);
        if total_votes > total_supply {
            return Err(GovError::InvalidVoteTotal);
        }

        // Quorum check: a minimum share of the total supply must have
        // participated (For + Against + Abstain) for the outcome to bind.
        let quorum_bps: u32 = s::get_persistent(&env, &KEY_QUORUM_BPS, 0u32);
        if quorum_bps > 0 && quorum_bps <= MAX_QUORUM_BPS {
            let threshold = total_supply
                .checked_mul(quorum_bps as i128)
                .map(|v| v / MAX_QUORUM_BPS as i128)
                .unwrap_or(i128::MAX);
            if total_votes < threshold {
                return Err(GovError::QuorumNotMet);
            }
        }

        // Check if proposal passed
        if proposal.for_votes > proposal.against_votes {
            proposal.passed = true;

            // Apply the governance action on-chain via cross-contract calls
            let action_key = (KEY_PROPOSAL, symbol_short!("action"), proposal_id);
            if let Some(action) = env
                .storage()
                .persistent()
                .get::<_, GovernanceAction>(&action_key)
            {
                Self::apply_action(&env, &action);
            }
        }
        proposal.executed = true;
        s::set_and_extend(&env, &key, &proposal, TTL_REFRESH_THRESHOLD);

        e::publish(
            &env,
            (symbol_short!("execute"), &executor, proposal_id),
            proposal.passed,
        );
        Ok(())
    }

    /// Governance interface version — bump on breaking changes.
    pub fn governance_version() -> u32 {
        1
    }

    /// Apply a governance action via cross-contract calls to DripPool/DripToken.
    fn apply_action(env: &Env, action: &GovernanceAction) {
        let admin_addr = env.current_contract_address();
        let pool_id: Address = s::get_persistent(
            env,
            &KEY_POOL_ID,
            Address::from_string(&String::from_str(env, ZERO_ADDRESS_STR)),
        );
        let token_id: Address = s::get_persistent(
            env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(env, ZERO_ADDRESS_STR)),
        );

        match action {
            GovernanceAction::SetRewardRate(rate) => {
                let pool_client = pool::DripPoolClient::new(env, &pool_id);
                pool_client.set_reward_rate(&admin_addr, rate);
            }
            GovernanceAction::SetMinStake(min) => {
                let pool_client = pool::DripPoolClient::new(env, &pool_id);
                pool_client.set_min_stake(&admin_addr, min);
            }
            GovernanceAction::SetMaxStake(max) => {
                let pool_client = pool::DripPoolClient::new(env, &pool_id);
                pool_client.set_max_stake(&admin_addr, max);
            }
            GovernanceAction::SetLockPeriod(period) => {
                let pool_client = pool::DripPoolClient::new(env, &pool_id);
                pool_client.set_lock_period(&admin_addr, period);
            }
            GovernanceAction::SetActive(active) => {
                let pool_client = pool::DripPoolClient::new(env, &pool_id);
                pool_client.set_active(&admin_addr, active);
            }
            GovernanceAction::MintTokens(to, amount) => {
                let token_client = token::DripTokenClient::new(env, &token_id);
                token_client.mint(&admin_addr, to, amount);
            }
        }
    }

    /// Get voting power by querying the token contract's balance.
    /// Uses cross-contract call to DripToken::balance().
    fn get_voting_power_internal(env: &Env, voter: &Address, token_id: &Address) -> i128 {
        let token_client = token::DripTokenClient::new(env, token_id);
        token_client.balance(voter)
    }

    // ---- Getters ----

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        let key = (KEY_PROPOSAL, proposal_id);
        env.storage().persistent().get(&key)
    }

    pub fn get_proposal_count(env: Env) -> u64 {
        s::get_persistent(&env, &KEY_PROPOSAL_COUNT, 0u64)
    }

    /// List proposals, most recent first, with a paginated (start, limit)
    /// window. start = 0 begins at the newest proposal. Caps the returned
    /// Vec to avoid unbounded reads.
    pub fn list_proposals(env: Env, start: u64, limit: u32) -> Vec<Proposal> {
        let mut out = Vec::new(&env);
        let count: u64 = s::get_persistent(&env, &KEY_PROPOSAL_COUNT, 0u64);
        if count == 0 || limit == 0 {
            return out;
        }

        let newest = count.saturating_sub(start);
        let window: u64 = limit as u64;
        let mut cursor = newest;
        let mut remaining = window;
        while cursor > 0 && remaining > 0 {
            let key = (KEY_PROPOSAL, cursor);
            if let Some(p) = env.storage().persistent().get::<_, Proposal>(&key) {
                out.push_back(p);
                remaining -= 1;
            }
            cursor -= 1;
        }
        out
    }

    pub fn get_vote(env: Env, voter: Address, proposal_id: u64) -> Option<VoteRecord> {
        let key = (KEY_VOTES, proposal_id, voter);
        env.storage().persistent().get(&key)
    }

    pub fn get_voting_power(env: Env, voter: Address) -> i128 {
        let token_id: Address = s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        Self::get_voting_power_internal(&env, &voter, &token_id)
    }

    /// Set the quorum requirement in basis points of total supply.
    /// 0 disables quorum entirely. Only the admin can change it.
    pub fn set_quorum(env: Env, admin: Address, quorum_bps: u32) -> Result<(), GovError> {
        let stored_admin: Address = s::get_persistent(
            &env,
            &s::KEY_ADMIN,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        if admin != stored_admin {
            return Err(GovError::NotAuthorized);
        }
        if quorum_bps > MAX_QUORUM_BPS {
            return Err(GovError::QuorumTooHigh);
        }
        admin.require_auth();
        s::set_and_extend(&env, &KEY_QUORUM_BPS, &quorum_bps, TTL_REFRESH_THRESHOLD);
        e::publish(&env, (symbol_short!("quorum"), &admin), quorum_bps);
        Ok(())
    }

    pub fn get_gov_config(env: Env) -> (Address, Address, u32, i128) {
        let token_id: Address = s::get_persistent(
            &env,
            &KEY_TOKEN_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        let pool_id: Address = s::get_persistent(
            &env,
            &KEY_POOL_ID,
            Address::from_string(&String::from_str(&env, ZERO_ADDRESS_STR)),
        );
        let voting_period: u32 = s::get_persistent(&env, &KEY_VOTING_PERIOD, 100u32);
        let min_power: i128 = s::get_persistent(&env, &KEY_MIN_POWER, 0i128);
        (token_id, pool_id, voting_period, min_power)
    }

    /// Current quorum threshold in basis points (0 = disabled).
    pub fn get_quorum(env: Env) -> u32 {
        s::get_persistent(&env, &KEY_QUORUM_BPS, 0u32)
    }
}

// ---- Tests ----

#[cfg(test)]
mod governance_test {
    use super::*;
    use crate::pool::DripPool;
    use crate::token::DripToken;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger as _;
    use soroban_sdk::Env;

    #[test]
    fn test_create_proposal() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);

        // Deploy token and mint to proposer for voting power
        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        token_client.mint(&admin, &proposer, &1000i128);

        let pool_id = Address::generate(&env);
        let contract_id = env.register(DripGovernance, ());
        let client = DripGovernanceClient::new(&env, &contract_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &100u32, &1i128);

        let id = client.propose(
            &proposer,
            &String::from_str(&env, "Reduce rewards"),
            &String::from_str(&env, "We should reduce the reward rate by 50%"),
            &GovernanceAction::SetRewardRate(50i128),
        );

        assert_eq!(id, 1);
        assert_eq!(client.get_proposal_count(), 1);

        let prop = client.get_proposal(&1).unwrap();
        assert!(!prop.executed);
        assert!(!prop.passed);
    }

    #[test]
    fn test_vote_and_execute() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        // Deploy token and mint to both proposer and voter
        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        token_client.mint(&admin, &proposer, &1000i128);
        token_client.mint(&admin, &voter, &5000i128);

        // Deploy governance first so we know its address
        let governance_id = env.register(DripGovernance, ());

        // Deploy pool and initialize it with governance as admin (so governance can call set_reward_rate etc.)
        let pool_id = env.register(DripPool, ());
        let pool_client = pool::DripPoolClient::new(&env, &pool_id);
        pool_client.initialize_pool(&governance_id, &token_id, &100i128, &10i128, &100u32);

        let client = DripGovernanceClient::new(&env, &governance_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &100u32, &0i128);

        let id = client.propose(
            &proposer,
            &String::from_str(&env, "Test proposal"),
            &String::from_str(&env, "Test description"),
            &GovernanceAction::SetRewardRate(50i128),
        );

        // Vote with real token balance as voting power
        client.vote(&voter, &id, &VoteChoice::For);
        let vote = client.get_vote(&voter, &id).unwrap();
        assert_eq!(vote.vote, VoteChoice::For);
        assert_eq!(vote.power, 5000i128);

        // Advance past voting period
        env.ledger().set_sequence_number(200);

        // Execute — governance should now be able to call pool.set_reward_rate()
        client.execute(&admin, &id);
        let prop = client.get_proposal(&id).unwrap();
        assert!(prop.executed);
        assert!(prop.passed);

        // Verify the pool's reward rate was actually changed
        let pool_config = pool_client.get_pool_config();
        assert_eq!(pool_config.reward_rate, 50i128);
    }

    #[test]
    fn test_cancel_proposal() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);
        let stranger = Address::generate(&env);

        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        token_client.mint(&admin, &proposer, &1000i128);

        let pool_id = Address::generate(&env);
        let contract_id = env.register(DripGovernance, ());
        let client = DripGovernanceClient::new(&env, &contract_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &100u32, &1i128);

        let id = client.propose(
            &proposer,
            &String::from_str(&env, "Cancel me"),
            &String::from_str(&env, "Should never execute"),
            &GovernanceAction::SetRewardRate(1i128),
        );

        // Non-proposer cannot cancel
        let err = client.try_cancel_proposal(&stranger, &id);
        assert!(err.is_err());

        // Proposer can cancel
        client.cancel_proposal(&proposer, &id);
        let prop = client.get_proposal(&id).unwrap();
        assert!(prop.executed);
        assert!(!prop.passed);

        // Cancelled proposals cannot be executed
        env.ledger().set_sequence_number(300);
        let err = client.try_execute(&admin, &id);
        assert!(err.is_err());
    }

    #[test]
    fn test_cancel_after_voting_ended_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);

        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        token_client.mint(&admin, &proposer, &1000i128);

        let pool_id = Address::generate(&env);
        let contract_id = env.register(DripGovernance, ());
        let client = DripGovernanceClient::new(&env, &contract_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &10u32, &1i128);

        let id = client.propose(
            &proposer,
            &String::from_str(&env, "Too late"),
            &String::from_str(&env, "Voting period is short"),
            &GovernanceAction::SetRewardRate(2i128),
        );

        env.ledger().set_sequence_number(500);
        let err = client.try_cancel_proposal(&proposer, &id);
        assert!(err.is_err());
    }

    #[test]
    fn test_version() {
        let env = Env::default();
        let contract_id = env.register(DripGovernance, ());
        let client = DripGovernanceClient::new(&env, &contract_id);
        assert_eq!(client.governance_version(), 1u32);
    }

    #[test]
    fn test_oversized_proposal_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);

        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        token_client.mint(&admin, &proposer, &1000i128);

        let pool_id = Address::generate(&env);
        let contract_id = env.register(DripGovernance, ());
        let client = DripGovernanceClient::new(&env, &contract_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &100u32, &1i128);

        let big_title = String::from_str(&env, &"x".repeat(600));
        let err = client.try_propose(
            &proposer,
            &big_title,
            &String::from_str(&env, "desc"),
            &GovernanceAction::SetRewardRate(1i128),
        );
        assert_eq!(err, Err(Ok(GovError::InvalidParameter)));

        let empty_title = String::from_str(&env, "");
        let err = client.try_propose(
            &proposer,
            &empty_title,
            &String::from_str(&env, "desc"),
            &GovernanceAction::SetRewardRate(1i128),
        );
        assert_eq!(err, Err(Ok(GovError::InvalidParameter)));
    }

    #[test]
    fn test_init_rejects_zero_voting_period() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_id = env.register(DripToken, ());
        let pool_id = Address::generate(&env);
        let contract_id = env.register(DripGovernance, ());
        let client = DripGovernanceClient::new(&env, &contract_id);

        let err = client.try_initialize_governance(&admin, &token_id, &pool_id, &0u32, &1i128);
        assert_eq!(err, Err(Ok(GovError::InvalidParameter)));
    }

    #[test]
    fn test_list_proposals_paginates() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);

        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        token_client.mint(&admin, &proposer, &1000i128);

        let pool_id = Address::generate(&env);
        let contract_id = env.register(DripGovernance, ());
        let client = DripGovernanceClient::new(&env, &contract_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &100u32, &1i128);

        for n in 1u64..=5u64 {
            client.propose(
                &proposer,
                &String::from_str(&env, &format!("P{n}")),
                &String::from_str(&env, "D"),
                &GovernanceAction::SetRewardRate(n as i128),
            );
        }
        assert_eq!(client.get_proposal_count(), 5u64);

        // Page 1: newest two first (5, 4).
        let page1 = client.list_proposals(&0u64, &2u32);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1.get(0).unwrap().id, 5u64);
        assert_eq!(page1.get(1).unwrap().id, 4u64);

        // Page 2: (3, 2).
        let page2 = client.list_proposals(&2u64, &2u32);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2.get(0).unwrap().id, 3u64);
        assert_eq!(page2.get(1).unwrap().id, 2u64);

        // Past the end returns what remains / nothing.
        let page3 = client.list_proposals(&4u64, &10u32);
        assert_eq!(page3.len(), 1);
        assert_eq!(page3.get(0).unwrap().id, 1u64);
        let empty = client.list_proposals(&5u64, &10u32);
        assert_eq!(empty.len(), 0);
    }

    #[test]
    fn test_quorum_required_for_execution() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        // Supply = 1900; 50% quorum requires 950 participating votes.
        token_client.mint(&admin, &proposer, &1000i128);
        token_client.mint(&admin, &voter, &900i128);

        let governance_id = env.register(DripGovernance, ());
        // Real pool with governance as admin so execute() can apply actions.
        let pool_id = env.register(DripPool, ());
        let pool_client = pool::DripPoolClient::new(&env, &pool_id);
        pool_client.initialize_pool(&governance_id, &token_id, &100i128, &10i128, &100u32);

        let client = DripGovernanceClient::new(&env, &governance_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &100u32, &0i128);
        // Require 50% participation (5000 bps).
        client.set_quorum(&admin, &5000u32);

        let id = client.propose(
            &proposer,
            &String::from_str(&env, "Q"),
            &String::from_str(&env, "D"),
            &GovernanceAction::SetRewardRate(1i128),
        );

        // Only 900 of 1900 supply votes — under the 950 quorum threshold.
        client.vote(&voter, &id, &VoteChoice::For);
        env.ledger().set_sequence_number(500);
        let err = client.try_execute(&admin, &id);
        assert_eq!(err, Err(Ok(GovError::QuorumNotMet)));
        assert!(!client.get_proposal(&id).unwrap().executed);

        // A second proposal that receives 1900 votes passes the quorum.
        let id2 = client.propose(
            &proposer,
            &String::from_str(&env, "Q2"),
            &String::from_str(&env, "D"),
            &GovernanceAction::SetRewardRate(2i128),
        );
        client.vote(&voter, &id2, &VoteChoice::For);
        client.vote(&proposer, &id2, &VoteChoice::For);
        env.ledger().set_sequence_number(900);
        client.execute(&admin, &id2);
        assert!(client.get_proposal(&id2).unwrap().passed);

        // Verify the pool reward rate was applied.
        let pool_config = pool_client.get_pool_config();
        assert_eq!(pool_config.reward_rate, 2i128);
    }

    #[test]
    fn test_quorum_validation() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);

        let token_id = env.register(DripToken, ());
        let pool_id = Address::generate(&env);
        let governance_id = env.register(DripGovernance, ());
        let client = DripGovernanceClient::new(&env, &governance_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &100u32, &0i128);

        // Over 100% quorum is rejected.
        let err = client.try_set_quorum(&admin, &10_001u32);
        assert_eq!(err, Err(Ok(GovError::QuorumTooHigh)));

        // Non-admin cannot change quorum.
        let err = client.try_set_quorum(&attacker, &1000u32);
        assert_eq!(err, Err(Ok(GovError::NotAuthorized)));

        client.set_quorum(&admin, &2500u32);
        assert_eq!(client.get_quorum(), 2500u32);
    }

    #[test]
    fn test_execute_rejects_votes_exceeding_supply() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        token_client.mint(&admin, &proposer, &1000i128);
        token_client.mint(&admin, &voter, &1000i128);

        let governance_id = env.register(DripGovernance, ());
        let pool_id = Address::generate(&env);
        let client = DripGovernanceClient::new(&env, &governance_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &100u32, &0i128);

        let id = client.propose(
            &proposer,
            &String::from_str(&env, "P"),
            &String::from_str(&env, "D"),
            &GovernanceAction::SetRewardRate(1i128),
        );

        // Corrupt the stored vote totals beyond total supply, simulating
        // double-counted votes.
        let key = (KEY_PROPOSAL, id);
        env.as_contract(&governance_id, || {
            let mut prop: Proposal = env.storage().persistent().get(&key).unwrap();
            prop.for_votes = 10_000i128;
            env.storage().persistent().set(&key, &prop);
        });

        env.ledger().set_sequence_number(500);
        let err = client.try_execute(&admin, &id);
        assert_eq!(err, Err(Ok(GovError::InvalidVoteTotal)));
    }

    #[test]
    fn test_execute_max_stake_action() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        let token_id = env.register(DripToken, ());
        let token_client = token::DripTokenClient::new(&env, &token_id);
        token_client.initialize_token(
            &admin,
            &String::from_str(&env, "DT"),
            &String::from_str(&env, "D"),
            &7u32,
        );
        token_client.mint(&admin, &proposer, &1000i128);
        token_client.mint(&admin, &voter, &5000i128);

        let governance_id = env.register(DripGovernance, ());
        let pool_id = env.register(DripPool, ());
        let pool_client = pool::DripPoolClient::new(&env, &pool_id);
        pool_client.initialize_pool(&governance_id, &token_id, &100i128, &10i128, &100u32);

        let client = DripGovernanceClient::new(&env, &governance_id);
        client.initialize_governance(&admin, &token_id, &pool_id, &100u32, &0i128);

        let id = client.propose(
            &proposer,
            &String::from_str(&env, "Raise max stake"),
            &String::from_str(&env, "Allow larger positions"),
            &GovernanceAction::SetMaxStake(50_000i128),
        );
        client.vote(&voter, &id, &VoteChoice::For);
        client.vote(&proposer, &id, &VoteChoice::For);

        env.ledger().set_sequence_number(500);
        client.execute(&admin, &id);

        let config = pool_client.get_pool_config();
        assert_eq!(config.max_stake, 50_000i128);
    }
}
