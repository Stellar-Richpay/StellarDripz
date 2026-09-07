"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ContractEvent } from "@/types/stellar";
import { directFetchContractEvents, directGetLatestLedger } from "@/lib/client/directClient";

interface UseContractEventsOptions {
  contractId: string;
  pollInterval?: number;
  enabled?: boolean;
}

/**
 * Hook for subscribing to real-time contract events.
 * Uses SSE (via API proxy) with direct Soroban RPC polling as fallback.
 * — hybrid: SSE goes through proxy, polling goes direct for lower latency.
 */
export function useContractEvents({
  contractId,
  pollInterval = 5000,
  enabled = true,
}: UseContractEventsOptions) {
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Reset the mounted flag on every mount (not just the first). React 18
  // StrictMode mounts → unmounts → remounts effects in development; without
  // re-setting the flag here, the second mount would permanently believe it
  // is unmounted and every SSE/poll callback would be dropped.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startDirectPolling = useCallback(() => {
    setError("SSE unavailable — polling directly from Soroban RPC");

    pollRef.current = setInterval(async () => {
      try {
        const latestLedger = await directGetLatestLedger();
        const startLedger = Math.max(0, latestLedger - 100);
        const result = await directFetchContractEvents(contractId, startLedger);

        if (!mountedRef.current) return;

        if (result.events.length > 0) {
          for (const evt of result.events) {
            const mapped: ContractEvent = {
              id: `${evt.topic}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              contractId: evt.contractId,
              topic: evt.topic || "unknown",
              value: evt.value || "",
              ledgerSequence: result.latestLedger,
              timestamp: new Date(),
              txHash: "",
            };
            setEvents((prev) => [mapped, ...prev].slice(0, 100));
          }
        }
        setConnected(true);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Direct poll failed");
      }
    }, pollInterval);
  }, [contractId, pollInterval]);

  // Main effect: connect SSE or fall back to direct polling
  useEffect(() => {
    if (!enabled || !contractId) return;

    // Clean up previous connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    stopPolling();

    let cancelled = false;

    // Try SSE via API proxy first
    try {
      const es = new EventSource(
        `/api/events?contractId=${encodeURIComponent(contractId)}&pollInterval=${pollInterval}`,
      );
      eventSourceRef.current = es;

      es.onopen = () => {
        if (cancelled || !mountedRef.current) return;
        setConnected(true);
        setError(null);
      };

      es.onmessage = (event) => {
        if (cancelled || !mountedRef.current) return;
        try {
          const parsed: ContractEvent = JSON.parse(event.data);
          setEvents((prev) => [parsed, ...prev].slice(0, 100));
        } catch {
          /* skip malformed */
        }
      };

      es.onerror = () => {
        if (cancelled || !mountedRef.current) return;
        setConnected(false);
        es.close();
        eventSourceRef.current = null;
        // Fall back to direct Soroban polling
        startDirectPolling();
      };
    } catch {
      // EventSource constructor threw — fall back to direct polling immediately
      startDirectPolling();
    }

    return () => {
      cancelled = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      stopPolling();
    };
  }, [contractId, pollInterval, enabled, startDirectPolling, stopPolling]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, error, clearEvents };
}
// The polling fallback queries Soroban RPC directly, bypassing the API proxy
