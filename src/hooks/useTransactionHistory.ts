"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { TransactionRecord, TxType } from "@/types/stellar";
import { fetchHistory } from "@/lib/client/apiClient";

interface UseTransactionHistoryOptions {
  /** Filter by Stellar address */
  address?: string;
  /** Filter by transaction type */
  type?: TxType;
  /** Max transactions to fetch */
  limit?: number;
  /** Auto-refresh interval in ms (0 = no auto-refresh) */
  refreshInterval?: number;
  /** Whether to fetch on mount */
  enabled?: boolean;
}

interface UseTransactionHistoryReturn {
  /** Transaction list (most recent first) */
  transactions: TransactionRecord[];
  /** Whether currently fetching */
  loading: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Total transaction count (may not equal transactions.length if limited) */
  total: number;
  /** True when more records exist beyond the current page */
  hasMore: boolean;
  /** Manually refresh the transaction list */
  refresh: () => Promise<void>;
}

function mapApiTransaction(tx: Record<string, unknown>): TransactionRecord {
  return {
    id: String(tx.id || ""),
    type: (tx.type as TxType) || "send",
    status: (tx.status as TransactionRecord["status"]) || "success",
    hash: (tx.hash as string) || null,
    amount: String(tx.amount || "0"),
    destination: (tx.destinationAddress as string) || (tx.destination as string) || "",
    // Never fabricate a timestamp: an absent value stays null so the UI can
    // say "unknown" instead of implying the transaction just happened.
    timestamp: tx.timestamp ? new Date(tx.timestamp as number) : null,
    assetCode: (tx.assetCode as string) || undefined,
    contractId: (tx.contractId as string) || undefined,
    functionName: (tx.functionName as string) || undefined,
    errorMessage: (tx.errorMessage as string) || undefined,
    memo: (tx.memo as string) || undefined,
    feeStroops: (tx.feeStroops as number) || undefined,
  };
}

/**
 * Hook for fetching and managing transaction history.
 * Supports filtering by address and type, with auto-refresh.
 */
export function useTransactionHistory({
  address,
  type,
  limit = 50,
  refreshInterval = 0,
  enabled = true,
}: UseTransactionHistoryOptions = {}): UseTransactionHistoryReturn {
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
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
    if (!enabled) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchHistory(address, type, limit);
      if (!mountedRef.current) return;

      const mapped = result.transactions.map(mapApiTransaction);
      setTransactions(mapped);
      setTotal(result.total);
      setHasMore(result.hasMore);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "History fetch failed");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [address, type, limit, enabled]);

  // Fetch on mount and when params change
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh. Skip ticks while the tab is hidden (background polls only
  // burn quota for data nobody sees) and refresh on return so the list is
  // current the moment the user switches back.
  useEffect(() => {
    if (!refreshInterval || refreshInterval <= 0) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, refreshInterval);

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, refreshInterval]);

  return { transactions, loading, error, total, hasMore, refresh };
}

export type { TransactionRecord, TxType };
