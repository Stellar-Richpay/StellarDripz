"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "@/context/AppContext";
import { getAppConfig } from "@/lib/env";
import { directReadContract } from "@/lib/client/directClient";
import {
  BADGE_TIER_NAMES,
  parseBadges,
  parseOwnedBadgeIds,
  type BadgeView,
} from "@/lib/contractReads";
import * as StellarSdk from "@stellar/stellar-sdk";
import { showToast } from "./Toast";

const TIER_ORDER = [1, 2, 3, 4];

const TIER_COLORS: Record<number, string> = {
  1: "from-orange-700/40 to-orange-700/10 border-orange-700/30",
  2: "from-slate-400/40 to-slate-400/10 border-slate-400/30",
  3: "from-yellow-500/40 to-yellow-500/10 border-yellow-500/30",
  4: "from-cyan-400/40 to-cyan-400/10 border-cyan-400/30",
};

/**
 * Badge gallery with tier progression. Reads the badge contract's
 * `list_badges` (all badges) and `list_user_badges` (the connected
 * wallet's claims), then groups by tier so the Bronze → Silver → Gold →
 * Platinum progression is visible at a glance.
 */
export default function BadgeGallery() {
  const { state } = useAppContext();
  const walletAddress = state.wallet.connected ? (state.wallet.publicKey ?? "") : "";
  const [badges, setBadges] = useState<BadgeView[]>([]);
  const [owned, setOwned] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const badgeId = getAppConfig().contractIdBadge;

  const load = useCallback(async () => {
    if (!badgeId || !walletAddress) return;
    setLoading(true);
    try {
      const [allRes, ownedRes] = await Promise.all([
        directReadContract(
          badgeId,
          "list_badges",
          [
            StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString("0")),
            StellarSdk.xdr.ScVal.scvU32(50),
          ],
          walletAddress,
        ),
        directReadContract(
          badgeId,
          "list_user_badges",
          [
            new StellarSdk.Address(walletAddress).toScVal(),
            StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString("0")),
            StellarSdk.xdr.ScVal.scvU32(50),
          ],
          walletAddress,
        ),
      ]);
      setBadges(parseBadges(allRes.result));
      setOwned(new Set(parseOwnedBadgeIds(ownedRes.result)));
    } catch (err) {
      showToast({
        type: "error",
        title: "Badges unavailable",
        message: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [badgeId, walletAddress]);

  useEffect(() => {
    load();
  }, [load]);

  const byTier = useMemo(() => {
    const map: Record<number, BadgeView[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const b of badges) {
      const tier = TIER_ORDER.includes(b.tier) ? b.tier : 1;
      map[tier].push(b);
    }
    return map;
  }, [badges]);

  const ownedCount = owned.size;

  if (!badgeId) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-surface-800/60 p-5 backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stellar-orange/10 text-sm">
            🎖️
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Badge Gallery</h3>
            <p className="text-[10px] text-white/30">
              {badges.length} badges · {ownedCount} earned
            </p>
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

      {/* Tier progression bar */}
      <div className="mb-4 flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
        {TIER_ORDER.map((tier, i) => {
          const tierCount = byTier[tier].length;
          const tierOwned = byTier[tier].filter((b) => owned.has(b.id)).length;
          const next = i + 1 < TIER_ORDER.length ? ` → ${BADGE_TIER_NAMES[TIER_ORDER[i + 1]]}` : "";
          return (
            <span key={tier} className="flex flex-1 items-center gap-1 text-[9px] text-white/40">
              <span
                className={`rounded-md border px-1.5 py-0.5 ${
                  tierOwned === tierCount && tierCount > 0
                    ? "bg-stellar-green/15 text-stellar-green"
                    : "text-white/50"
                }`}
              >
                {BADGE_TIER_NAMES[tier]} {tierOwned}/{tierCount}
              </span>
              {next && <span className="text-white/20">→</span>}
            </span>
          );
        })}
      </div>

      {badges.length === 0 ? (
        <p className="py-6 text-center text-xs text-white/25">
          {loading ? "Loading…" : "No badges minted yet."}
        </p>
      ) : (
        <div className="space-y-4">
          {TIER_ORDER.map((tier) => {
            const list = byTier[tier];
            if (list.length === 0) return null;
            return (
              <div key={tier}>
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-white/30">
                  {BADGE_TIER_NAMES[tier]}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {list.map((b) => {
                    const earned = owned.has(b.id);
                    return (
                      <div
                        key={b.id}
                        className={`rounded-xl border bg-gradient-to-br p-3 ${TIER_COLORS[tier]} ${
                          earned ? "" : "opacity-60 saturate-50"
                        }`}
                        title={b.description}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xl">{b.imageUri ? "🏅" : "🎖️"}</span>
                          {earned ? (
                            <span className="rounded-md bg-stellar-green/15 px-1.5 py-0.5 text-[9px] text-stellar-green">
                              earned
                            </span>
                          ) : (
                            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] text-white/40">
                              locked
                            </span>
                          )}
                        </div>
                        <p className="mt-2 truncate text-xs font-semibold text-white/80">
                          {b.name}
                        </p>
                        <p className="truncate text-[9px] text-white/40">{b.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
