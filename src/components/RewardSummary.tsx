"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppContext } from "@/context/AppContext";
import { getAppConfig } from "@/lib/env";
import { directReadContract, directGetLatestLedger } from "@/lib/client/directClient";
import { formatTokenAmount, parseStake, type StakeView } from "@/lib/contractReads";
import * as StellarSdk from "@stellar/stellar-sdk";
import { showToast } from "./Toast";

interface PoolConfigView {
  rewardRate: bigint;
  lockPeriod: number;
}

function parsePoolConfig(result: unknown): PoolConfigView {
  if (!result || typeof result !== "object") {
    return { rewardRate: BigInt(0), lockPeriod: 0 };
  }
  const c = result as Record<string, unknown>;
  return {
    rewardRate:
      typeof c.reward_rate === "bigint" || typeof c.reward_rate === "number"
        ? BigInt(c.reward_rate)
        : BigInt(0),
    lockPeriod: typeof c.lock_period === "number" ? c.lock_period : Number(c.lock_period ?? 0),
  };
}

/**
 * The connected wallet's staking position and reward history: staked
 * amount, currently claimable rewards, total rewards already claimed, and
 * (with a live latest-ledger probe) whether the lock period has elapsed.
 */
export default function RewardSummary() {
  const { state } = useAppContext();
  const walletAddress = state.wallet.connected ? (state.wallet.publicKey ?? "") : "";
  const [stake, setStake] = useState<StakeView | null>(null);
  const [claimable, setClaimable] = useState<bigint | null>(null);
  const [config, setConfig] = useState<PoolConfigView>({ rewardRate: BigInt(0), lockPeriod: 0 });
  const [latestLedger, setLatestLedger] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const poolId = getAppConfig().contractIdDripPool;

  const load = useCallback(async () => {
    if (!poolId || !walletAddress) return;
    setLoading(true);
    try {
      const [stakeRes, rewardRes, configRes, ledger] = await Promise.all([
        directReadContract(
          poolId,
          "get_stake",
          [new StellarSdk.Address(walletAddress).toScVal()],
          walletAddress,
        ),
        directReadContract(
          poolId,
          "calculate_reward",
          [new StellarSdk.Address(walletAddress).toScVal()],
          walletAddress,
        ),
        directReadContract(poolId, "get_pool_config", [], walletAddress),
        directGetLatestLedger(),
      ]);
      setStake(parseStake(stakeRes.result));
      setClaimable(
        typeof rewardRes.result === "bigint"
          ? rewardRes.result
          : typeof rewardRes.result === "number"
            ? BigInt(rewardRes.result)
            : BigInt(0),
      );
      setConfig(parsePoolConfig(configRes.result));
      setLatestLedger(ledger);
    } catch (err) {
      showToast({
        type: "error",
        title: "Rewards unavailable",
        message: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [poolId, walletAddress]);

  useEffect(() => {
    load();
  }, [load]);

  if (!poolId) return null;

  const staked = stake?.amount ?? BigInt(0);
  const lockedUntil = stake ? stake.startLedger + config.lockPeriod : 0;
  const lockElapsed = latestLedger !== null && stake ? latestLedger >= lockedUntil : null;
  const totalRewards = (stake?.rewardClaimed ?? BigInt(0)) + (claimable ?? BigInt(0));

  return (
    <div className="rounded-2xl border border-white/10 bg-surface-800/60 p-5 backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stellar-green/10 text-sm">
            💎
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Your Rewards</h3>
            <p className="text-[10px] text-white/30">Staking position & reward history</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] text-white/60 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <p className="text-[10px] text-white/30">Staked</p>
          <p className="mt-1 font-mono text-lg font-semibold text-white">
            {formatTokenAmount(staked)}
          </p>
          {lockElapsed !== null && (
            <p
              className={`mt-1 text-[9px] ${lockElapsed ? "text-stellar-green" : "text-yellow-400/80"}`}
            >
              {staked > BigInt(0)
                ? lockElapsed
                  ? "lock elapsed — unstakeable"
                  : `locked until ledger ${lockedUntil}`
                : "no active stake"}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <p className="text-[10px] text-white/30">Claimable</p>
          <p className="mt-1 font-mono text-lg font-semibold text-stellar-green">
            {formatTokenAmount(claimable ?? BigInt(0))}
          </p>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px]">
        <div className="flex justify-between">
          <dt className="text-white/30">Claimed so far</dt>
          <dd className="font-mono text-white/70">
            {formatTokenAmount(stake?.rewardClaimed ?? BigInt(0))}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-white/30">Lifetime rewards</dt>
          <dd className="font-mono text-white/70">{formatTokenAmount(totalRewards)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-white/30">Reward rate</dt>
          <dd className="font-mono text-white/70">{config.rewardRate.toString()}</dd>
        </div>
      </dl>
    </div>
  );
}
