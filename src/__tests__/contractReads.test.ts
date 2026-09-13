import {
  BADGE_TIER_NAMES,
  formatTokenAmount,
  parseBadges,
  parseLeaderboard,
  parseOwnedBadgeIds,
  parseStake,
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
});
