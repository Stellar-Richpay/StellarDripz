"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { BalanceInfo, AssetBalance } from "@/types/stellar";
import { directFetchBalance } from "@/lib/client/directClient";

interface UseBalanceOptions {
  /** Stellar public key — if null/empty, balance is not fetched */
  address: string | null;
  /** Auto-refresh interval in ms (0 = no auto-refresh) */
  refreshInterval?: number;
  /** Whether to fetch on mount */
  enabled?: boolean;
}

interface UseBalanceReturn {
  /** Balance info including XLM, raw amount, and other assets */
  balance: BalanceInfo;
  /** Whether balance is currently loading */
  loading: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Manually refresh the balance */
  refresh: () => Promise<void>;
}

const EMPTY_BALANCE: BalanceInfo = {
  xlm: "0.0000000",
  raw: "0",
  assets: [],
  lastFetched: null,
};

/**
 * Hook for fetching Stellar account balances directly from Horizon.
 * Uses direct read (no API proxy) for lower latency.
 */
export function useBalance({
  address,
  refreshInterval = 0,
  enabled = true,
}: UseBalanceOptions): UseBalanceReturn {
  const [balance, setBalance] = useState<BalanceInfo>(EMPTY_BALANCE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Reset the mounted flag on every mount (not just the first). React 18
  // StrictMode mounts → unmounts → remounts effects in development; without
  // re-setting the flag here, the second mount would permanently believe it
  // is unmounted and every fetch would be dropped.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!address || !enabled) return;

    setLoading(true);
    setError(null);

    try {
      const info = await directFetchBalance(address);
      if (!mountedRef.current) return;

      const assets: AssetBalance[] = (info.assets || []).map((a) => ({
        asset: {
          code: a.code,
          issuer: a.issuer || "",
          type: a.code === "XLM" ? ("native" as const) : ("credit_alphanum4" as const),
        },
        balance: a.balance,
        formatted: a.formatted,
      }));

      setBalance({
        xlm: info.xlm,
        raw: info.raw,
        assets,
        lastFetched: new Date(),
      });
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : "Balance fetch failed";
      setError(message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [address, enabled]);

  // Fetch on mount and when address changes
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh
  useEffect(() => {
    if (!refreshInterval || refreshInterval <= 0 || !address) return;

    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval, address]);

  return { balance, loading, error, refresh };
}

export type { BalanceInfo, AssetBalance };
