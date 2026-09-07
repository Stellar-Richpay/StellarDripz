"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { requestFaucet } from "@/lib/client/apiClient";

interface UseFaucetOptions {
  /** Stellar public key to fund */
  address: string | null;
  /** Cooldown window in ms (default: 60000 = 1 minute) */
  cooldownMs?: number;
}

interface UseFaucetReturn {
  /** Whether a faucet request is in progress */
  requesting: boolean;
  /** Whether faucet request succeeded (resets on new request) */
  success: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Last transaction hash from faucet */
  lastHash: string | null;
  /** Remaining cooldown time in ms (0 = ready) */
  cooldownRemaining: number;
  /** Whether a request can be made now */
  canRequest: boolean;
  /** Request faucet funds */
  request: () => Promise<void>;
}

/**
 * Hook for requesting testnet XLM from the faucet.
 * Includes client-side cooldown tracking to prevent spamming.
 */
export function useFaucet({ address, cooldownMs = 60000 }: UseFaucetOptions): UseFaucetReturn {
  const [requesting, setRequesting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const lastRequestRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownMsRef = useRef(cooldownMs);
  const mountedRef = useRef(true);

  // Keep cooldownMs ref in sync to avoid stale timer closures
  useEffect(() => {
    cooldownMsRef.current = cooldownMs;
  }, [cooldownMs]);

  // Reset the mounted flag on every mount (not just the first). React 18
  // StrictMode mounts → unmounts → remounts effects in development; without
  // re-setting the flag here, the second mount would permanently believe it
  // is unmounted and every fetch would be dropped.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Update cooldown countdown — uses ref to avoid stale cooldownMs
  const updateCooldown = useCallback(() => {
    if (!mountedRef.current) return;
    const now = Date.now();
    const elapsed = now - lastRequestRef.current;
    const remaining = Math.max(0, cooldownMsRef.current - elapsed);

    setCooldownRemaining(remaining);

    if (remaining <= 0 && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const canRequest = useMemo(
    () => !requesting && cooldownRemaining === 0 && !!address,
    [requesting, cooldownRemaining, address],
  );

  const request = useCallback(async () => {
    if (!address || !canRequest) return;

    setRequesting(true);
    setSuccess(false);
    setError(null);
    setLastHash(null);

    try {
      const result = await requestFaucet(address);
      if (!mountedRef.current) return;

      setLastHash(result.hash);
      setSuccess(true);

      // Start cooldown
      lastRequestRef.current = Date.now();
      setCooldownRemaining(cooldownMsRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(updateCooldown, 200);
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : "Faucet request failed";
      setError(message);
    } finally {
      if (mountedRef.current) setRequesting(false);
    }
  }, [address, canRequest, updateCooldown]);

  return {
    requesting,
    success,
    error,
    lastHash,
    cooldownRemaining,
    canRequest,
    request,
  };
}
