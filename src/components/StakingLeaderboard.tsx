"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppContext } from "@/context/AppContext";
import { getAppConfig } from "@/lib/env";
import { directReadContract } from "@/lib/client/directClient";
import { formatTokenAmount, parseLeaderboard, type LeaderboardEntry } from "@/lib/contractReads";
import * as StellarSdk from "@stellar/stellar-sdk";
import { showToast } from "./Toast";

/**
 * Top stakers leaderboard, read directly from the DripPool contract's
 * `list_top_stakers` (bounded on-chain board refreshed on every stake).
 * Requires the pool contract ID to be configured.
 */
export default function StakingLeaderboard() {
  const { state } = useAppContext();
  const walletAddress = state.wallet.connected ? (state.wallet.publicKey ?? "") : "";
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const poolId = getAppConfig().contractIdDripPool;

  const load = useCallback(async () => {
    if (!poolId || !walletAddress) return;
    setLoading(true);
    try {
      const { result } = await directReadContract(
        poolId,
        "list_top_stakers",
        [StellarSdk.xdr.ScVal.scvU32(0), StellarSdk.xdr.ScVal.scvU32(25)],
        walletAddress,
      );
      setEntries(parseLeaderboard(result));
    } catch (err) {
      showToast({
        type: "error",
        title: "Leaderboard unavailable",
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

  return (
    <div className="rounded-2xl border border-white/10 bg-surface-800/60 p-5 backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stellar-purple/10 text-sm">
            🏆
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Staking Leaderboard</h3>
            <p className="text-[10px] text-white/30">Top stakers by amount</p>
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

      {entries.length === 0 ? (
        <p className="py-6 text-center text-xs text-white/25">
          {loading ? "Loading…" : "No stakes yet — be the first on the board."}
        </p>
      ) : (
        <ol className="divide-y divide-white/5">
          {entries.map((e, i) => {
            const highlighted = walletAddress && e.address === walletAddress;
            return (
              <li
                key={e.address}
                className={`flex items-center gap-3 px-2 py-2 ${highlighted ? "rounded-lg bg-stellar-blue/10" : ""}`}
              >
                <span className="w-6 text-center font-mono text-xs text-white/40">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                </span>
                <span className="flex-1 truncate font-mono text-xs text-white/70">
                  {e.address.slice(0, 6)}…{e.address.slice(-4)}
                  {highlighted && <span className="ml-2 text-[9px] text-stellar-blue">you</span>}
                </span>
                <span className="font-mono text-xs text-white">{formatTokenAmount(e.amount)}</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-2 text-right text-[9px] text-white/20">Amounts in DRIP (7 decimals)</p>
    </div>
  );
}
