import {
  BADGE_TIER_NAMES,
  formatTokenAmount,
  parseBadges,
  parseLeaderboard,
  parseOwnedBadgeIds,
  parseStake,
  parseProposal,
  parseProposals,
  parseGovConfig,
} from "@/lib/contractReads";

describe("contractReads parsing", () => {
  it("parses a leaderboard of [address, amount] pairs", () => {
    const board = parseLeaderboard([
      ["GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", BigInt(5000)],
      ["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", BigInt(1000)],
    ]);
    expect(board).toHaveLength(2);
    expect(board[0].address).toMatch(/^G/);
    expect(board[0].amount).toBe(BigInt(5000));
  });

  it("returns an empty leaderboard for malformed input", () => {
    expect(parseLeaderboard(undefined)).toEqual([]);
    expect(parseLeaderboard("nope")).toEqual([]);
    expect(parseLeaderboard([[123]])).toEqual([]);
  });

  it("parses badge structs and normalizes the tier", () => {
    const badges = parseBadges([
      { id: 1, name: "Early Dripper", description: "First faucet use", image_uri: "", tier: 1 },
      { id: 2, name: "Staker", description: "Staked tokens", image_uri: "ipfs://x", tier: 3 },
    ]);
    expect(badges[0].name).toBe("Early Dripper");
    expect(badges[0].tier).toBe(1);
    expect(badges[1].tier).toBe(3);
    expect(BADGE_TIER_NAMES[1]).toBe("Bronze");
    expect(BADGE_TIER_NAMES[4]).toBe("Platinum");
  });

  it("parses owned badge id lists", () => {
    expect(parseOwnedBadgeIds([1, 3, "7"])).toEqual([1, 3, 7]);
    expect(parseOwnedBadgeIds(undefined)).toEqual([]);
  });

  it("parses a stake struct with defaults", () => {
    const stake = parseStake({
      amount: BigInt(10000000),
      start_ledger: 42,
      reward_claimed: BigInt(250),
    });
    expect(stake.amount).toBe(BigInt(10000000));
    expect(stake.startLedger).toBe(42);
    expect(stake.rewardClaimed).toBe(BigInt(250));
    expect(parseStake(null)).toEqual({
      amount: BigInt(0),
      startLedger: 0,
      rewardClaimed: BigInt(0),
    });
  });

  it("formats token amounts with 7 decimals", () => {
    expect(formatTokenAmount(BigInt(10000000))).toBe("1");
    expect(formatTokenAmount(BigInt(10000005))).toBe("1.0000005");
    expect(formatTokenAmount(BigInt(5))).toBe("0.0000005");
    expect(formatTokenAmount(BigInt(0))).toBe("0");
    expect(formatTokenAmount(BigInt(-15000000))).toBe("-1.5");
    expect(formatTokenAmount(BigInt(123456789))).toBe("12.3456789");
  });

  it("parses proposal structs and lists defensively", () => {
    const rawProposal = {
      id: 1,
      proposer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      title: "Increase Reward Rate",
      description: "Bump pool reward rate by 10%",
      for_votes: BigInt(5000000),
      against_votes: BigInt(100000),
      abstain_votes: BigInt(0),
      created_ledger: 100,
      voting_end: 200,
      executed: false,
      passed: true,
    };

    const parsed = parseProposal(rawProposal);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(1);
    expect(parsed?.title).toBe("Increase Reward Rate");
    expect(parsed?.forVotes).toBe(BigInt(5000000));
    expect(parsed?.passed).toBe(true);
    expect(parsed?.executed).toBe(false);

    expect(parseProposal(null)).toBeNull();
    expect(parseProposal({})).toBeNull();

    const list = parseProposals([rawProposal, { id: 2, title: "P2" }]);
    expect(list).toHaveLength(2);
    expect(parseProposals(null)).toEqual([]);
  });

  it("parses governance config tuple correctly", () => {
    const config = parseGovConfig([
      "CD3YTU3JCBEMNNVISPTLPVYQATDGIRBJPLVJ2MIO3W56O7TYSWDG3GY6",
      "CCBNJTZ22HDJTQHIINS22FNIK5KRYIW3CPORFAKNCBMWWL7SRJMZIR6X",
      1000,
      BigInt(50000000),
    ]);
    expect(config.tokenId).toBe("CD3YTU3JCBEMNNVISPTLPVYQATDGIRBJPLVJ2MIO3W56O7TYSWDG3GY6");
    expect(config.poolId).toBe("CCBNJTZ22HDJTQHIINS22FNIK5KRYIW3CPORFAKNCBMWWL7SRJMZIR6X");
    expect(config.votingPeriod).toBe(1000);
    expect(config.minPower).toBe(BigInt(50000000));

    expect(parseGovConfig([])).toEqual({
      tokenId: "",
      poolId: "",
      votingPeriod: 0,
      minPower: BigInt(0),
    });
  });
});
