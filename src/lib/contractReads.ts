/**
 * Parsing helpers for structured Soroban reads (leaderboard, badges, stake).
 *
 * `directReadContract` returns scValToNative output, which is close to JSON
 * (Vecs → arrays, structs → plain objects, i128 → BigInt) but is not
 * guaranteed by a schema. These parsers validate the shape defensively so a
 * contract change degrades to an empty list instead of a crash.
 */

export interface LeaderboardEntry {
  address: string;
  /** Staked amount in smallest token units. */
  amount: bigint;
}

export interface BadgeView {
  id: number;
  name: string;
  description: string;
  imageUri: string;
  /** 1=Bronze, 2=Silver, 3=Gold, 4=Platinum. */
  tier: number;
}

export interface StakeView {
  amount: bigint;
  startLedger: number;
  rewardClaimed: bigint;
}

export interface ProposalView {
  id: number;
  proposer: string;
  title: string;
  description: string;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  createdLedger: number;
  votingEnd: number;
  executed: boolean;
  passed: boolean;
}

export interface GovernanceConfigView {
  tokenId: string;
  poolId: string;
  votingPeriod: number;
  minPower: bigint;
}

export const BADGE_TIER_NAMES: Record<number, string> = {
  1: "Bronze",
  2: "Silver",
  3: "Gold",
  4: "Platinum",
};

/** 7-decimal token units (matches the deployed DripToken decimals). */
const TOKEN_DECIMALS = BigInt(10_000_000);

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return BigInt(0);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * list_top_stakers returns Vec<(Address, i128)> — each entry is a
 * 2-element array [addressString, amountBigInt].
 */
export function parseLeaderboard(result: unknown): LeaderboardEntry[] {
  if (!Array.isArray(result)) return [];
  const entries: LeaderboardEntry[] = [];
  for (const raw of result) {
    if (Array.isArray(raw) && raw.length >= 2) {
      entries.push({ address: asString(raw[0]), amount: asBigInt(raw[1]) });
    }
  }
  return entries;
}

/** list_badges returns Vec<Badge> — objects with id/name/description/image_uri/tier. */
export function parseBadges(result: unknown): BadgeView[] {
  if (!Array.isArray(result)) return [];
  const badges: BadgeView[] = [];
  for (const raw of result) {
    if (raw && typeof raw === "object") {
      const b = raw as Record<string, unknown>;
      badges.push({
        id: typeof b.id === "number" ? b.id : Number(b.id ?? 0),
        name: asString(b.name),
        description: asString(b.description),
        imageUri: asString(b.image_uri),
        tier: typeof b.tier === "number" ? b.tier : Number(b.tier ?? 1),
      });
    }
  }
  return badges;
}

/** list_user_badges returns Vec<u64> — plain badge id numbers. */
export function parseOwnedBadgeIds(result: unknown): number[] {
  if (!Array.isArray(result)) return [];
  const ids: number[] = [];
  for (const raw of result) {
    if (typeof raw === "number") ids.push(raw);
    else if (typeof raw === "string" && /^\d+$/.test(raw)) ids.push(Number(raw));
  }
  return ids;
}

/** get_stake returns a StakeInfo struct. */
export function parseStake(result: unknown): StakeView {
  if (!result || typeof result !== "object") {
    return { amount: BigInt(0), startLedger: 0, rewardClaimed: BigInt(0) };
  }
  const s = result as Record<string, unknown>;
  return {
    amount: asBigInt(s.amount),
    startLedger: typeof s.start_ledger === "number" ? s.start_ledger : Number(s.start_ledger ?? 0),
    rewardClaimed: asBigInt(s.reward_claimed),
  };
}

/** Parse a single proposal struct from get_proposal or list_proposals. */
export function parseProposal(result: unknown): ProposalView | null {
  if (!result || typeof result !== "object") return null;
  const p = result as Record<string, unknown>;
  const id = typeof p.id === "number" ? p.id : Number(p.id ?? 0);
  if (!id) return null;
  return {
    id,
    proposer: asString(p.proposer),
    title: asString(p.title),
    description: asString(p.description),
    forVotes: asBigInt(p.for_votes),
    againstVotes: asBigInt(p.against_votes),
    abstainVotes: asBigInt(p.abstain_votes),
    createdLedger:
      typeof p.created_ledger === "number" ? p.created_ledger : Number(p.created_ledger ?? 0),
    votingEnd: typeof p.voting_end === "number" ? p.voting_end : Number(p.voting_end ?? 0),
    executed: Boolean(p.executed),
    passed: Boolean(p.passed),
  };
}

/** list_proposals returns Vec<Proposal>. */
export function parseProposals(result: unknown): ProposalView[] {
  if (!Array.isArray(result)) return [];
  const proposals: ProposalView[] = [];
  for (const raw of result) {
    const parsed = parseProposal(raw);
    if (parsed) proposals.push(parsed);
  }
  return proposals;
}

/** parse get_gov_config tuple (token_id, pool_id, voting_period, min_power). */
export function parseGovConfig(result: unknown): GovernanceConfigView {
  if (!Array.isArray(result) || result.length < 4) {
    return { tokenId: "", poolId: "", votingPeriod: 0, minPower: BigInt(0) };
  }
  return {
    tokenId: asString(result[0]),
    poolId: asString(result[1]),
    votingPeriod: typeof result[2] === "number" ? result[2] : Number(result[2] ?? 0),
    minPower: asBigInt(result[3]),
  };
}

/**
 * Format a token amount in smallest units (7 decimals) as a readable
 * decimal string, e.g. 10000000 → "10.0000000". Handles BigInt and
 * numbers; returns "0" for anything unreadable.
 */
export function formatTokenAmount(raw: bigint | number | string): string {
  const value = asBigInt(raw);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = abs / TOKEN_DECIMALS;
  const fraction = (abs % TOKEN_DECIMALS).toString().padStart(7, "0");
  const trimmed = fraction.replace(/0+$/, "");
  const out = `${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
  return negative ? `-${out}` : out;
}
