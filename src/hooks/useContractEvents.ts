"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ContractEvent } from "@/types/stellar";
import { directFetchContractEvents, directGetLatestLedger } from "@/lib/client/directClient";

interface UseContractEventsOptions {
  contractId: string;
  pollInterval?: number;
  enabled?: boolean;
}

/** Stable identity for an event, used to drop duplicates across SSE + polling. */
export function eventKey(evt: ContractEvent): string {
  return [evt.contractId, evt.topic, evt.value, evt.ledgerSequence || "", evt.txHash || ""].join(
    "|",
  );
}

/** Prepend incoming events, skipping any whose key already exists. */
export function appendUnique(prev: ContractEvent[], incoming: ContractEvent[]): ContractEvent[] {
  if (incoming.length === 0) return prev;
  const known = new Set(prev.map(eventKey));
  const fresh = incoming.filter((e) => !known.has(eventKey(e)));
  if (fresh.length === 0) return prev;
  return [...fresh, ...prev].slice(0, 100);
}

/**
 * Drop events whose key was already surfaced in an earlier polling round,
 * recording the new ones in `seenKeys` for future rounds. Unlike appendUnique
 * (which only sees the current in-memory list), this persists across rounds so
 * an event that scrolls off the display cap can never be re-added by a later
 * poll of the same ledger window.
 */
export function filterFresh(incoming: ContractEvent[], seenKeys: Set<string>): ContractEvent[] {
  const fresh = incoming.filter((e) => !seenKeys.has(eventKey(e)));
  for (const e of fresh) seenKeys.add(eventKey(e));
  return fresh;
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
  // Keys of every event this hook has already surfaced. Without this, the
  // direct-poll fallback re-delivers the same on-chain event on every round:
  // each poll assigns a fresh ledgerSequence (the latest ledger at poll time)
  // and empty txHash, so appendUnique's within-batch dedupe can't see the
  // event was already shown. The set persists across rounds and is bounded
  // below so it can't grow without limit.
  const seenKeysRef = useRef<Set<string>>(new Set());

  // Reset the mounted flag on every mount (not just the first). React 18
  // StrictMode mounts → unmounts → remounts effects in development; without
  // re-setting the flag here, the second mount would permanently believe it
  // is unmounted and every SSE/poll callback would be dropped.
  useEffect(() => {
    mountedRef.current = true;
    seenKeysRef.current = new Set();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Bound the seen-keys set: with a 100-ledger sliding window the same event
  // is only re-deliverable while it remains in range, but a contract emitting
  // many distinct events could still grow the set over a long session.
  useEffect(() => {
    if (seenKeysRef.current.size > 1000) {
      seenKeysRef.current = new Set(Array.from(seenKeysRef.current).slice(-500));
    }
  });

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startDirectPolling = useCallback(() => {
    setError("SSE unavailable — polling directly from Soroban RPC");

    pollRef.current = setInterval(async () => {
      // Skip ticks while the tab is hidden: a background tab polling Soroban
      // RPC every few seconds burns the RPC provider's quota (and the user's
      // data) for events nobody is looking at. The next visible tick resumes
      // from the same ledger cursor, so no events are lost — they just batch
      // up until the user returns.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const latestLedger = await directGetLatestLedger();
        // A failed RPC health check returns 0; polling from ledger 0 would
        // replay the contract's entire history. Skip the round instead.
        if (!mountedRef.current || latestLedger <= 0) return;
        const startLedger = Math.max(0, latestLedger - 100);
        const result = await directFetchContractEvents(contractId, startLedger);

        if (!mountedRef.current) return;

        if (result.events.length > 0) {
          const incoming: ContractEvent[] = result.events.map((evt) => ({
            id: `${evt.topic}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            contractId: evt.contractId,
            topic: evt.topic || "unknown",
            value: evt.value || "",
            // Use the event's real ledger when the RPC reported it; the
            // round's latest ledger is only a fallback. A stable ledger is
            // what makes the dedupe key stable across polls.
            ledgerSequence: evt.ledger || result.latestLedger,
            timestamp: new Date(),
            txHash: "",
          }));
          // Cross-round dedupe: drop anything already surfaced in an earlier
          // round, then remember the new keys so the next round skips them.
          const fresh = filterFresh(incoming, seenKeysRef.current);
          if (fresh.length > 0) {
            setEvents((prev) => appendUnique(prev, fresh));
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
          // SSE events lack id/ledgerSequence, so give them a stable id so
          // duplicates are dropped rather than stacking up.
          const normalized: ContractEvent = {
            ...parsed,
            id: parsed.id || eventKey(parsed),
          };
          setEvents((prev) => appendUnique(prev, [normalized]));
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
