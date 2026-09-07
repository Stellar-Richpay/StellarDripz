"use client";

import { useAppContext } from "@/context/AppContext";
import { useState } from "react";
import type { AssetBalance } from "@/types/stellar";
import { STELLAR_NETWORK } from "@/lib/stellar/network";

function AssetRow({ asset }: { asset: AssetBalance }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.01] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stellar-blue/10 text-[10px] font-bold text-stellar-blue">
          {asset.asset.code.slice(0, 4)}
        </span>
        <span className="text-xs font-medium text-white/70">{asset.asset.code}</span>
      </div>
      <span className="font-mono text-xs text-white/50">{asset.formatted}</span>
    </div>
  );
}

export default function BalanceCard() {
  const { state, refreshBalance } = useAppContext();
  const { wallet, balance } = state;
  const [refreshing, setRefreshing] = useState(false);
  const [showAllAssets, setShowAllAssets] = useState(false);

  if (!wallet.connected) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshBalance();
    setRefreshing(false);
  };

  const nonNativeAssets = balance.assets.filter((a) => a.asset.type !== "native");

  return (
    <div className="rounded-2xl border border-white/10 bg-surface-800/60 p-6 backdrop-blur-md animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">Balances</h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing || balance.loading}
          className="group flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/50 transition-all hover:border-white/20 hover:text-white/80 disabled:opacity-50"
        >
          <svg
            className={`h-3.5 w-3.5 transition-transform ${
              refreshing ? "animate-spin" : "group-hover:rotate-180"
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
            />
          </svg>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {balance.error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">
            Failed to load balances.
            {STELLAR_NETWORK.network === "TESTNET"
              ? " The account may not exist yet — try the faucet!"
              : " Check that the address is funded on mainnet."}
          </p>
          <button
            onClick={handleRefresh}
            className="mt-2 text-xs text-red-300 underline hover:text-red-200"
          >
            Retry
          </button>
        </div>
      ) : balance.loading ? (
        <div className="space-y-3 py-2">
          <div className="h-8 w-40 animate-pulse rounded-lg bg-white/5" />
          <div className="h-6 w-32 animate-pulse rounded-lg bg-white/5" />
        </div>
      ) : (
        <>
          {/* XLM — primary */}
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-4xl font-bold text-white tracking-tight">{balance.xlm}</span>
            <span className="text-lg font-semibold text-stellar-blue">XLM</span>
          </div>

          {/* Unfunded account — point at the faucet */}
          {parseFloat(balance.raw) === 0 && (
            <div className="mt-3 rounded-xl border border-stellar-blue/20 bg-stellar-blue/5 px-3 py-2">
              <p className="text-xs text-stellar-blue/80">
                No XLM yet — use the faucet below to fund this account.
              </p>
            </div>
          )}

          {/* Other assets */}
          {nonNativeAssets.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowAllAssets(!showAllAssets)}
                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                <svg
                  className={`h-3 w-3 transition-transform ${showAllAssets ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {nonNativeAssets.length} other asset
                {nonNativeAssets.length !== 1 ? "s" : ""}
              </button>

              {showAllAssets && (
                <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {nonNativeAssets.map((a) => (
                    <AssetRow key={`${a.asset.code}-${a.asset.issuer}`} asset={a} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {balance.lastFetched && !balance.loading && !balance.error && (
        <p className="mt-3 text-xs text-white/30">
          Last updated: {balance.lastFetched.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
