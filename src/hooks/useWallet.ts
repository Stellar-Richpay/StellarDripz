"use client";

import { useState, useCallback, useEffect } from "react";
import type { WalletState, SupportedWallet } from "@/types/stellar";
import {
  connectWithWallet,
  clearPersistedWallet,
  checkAnyWalletInstalled,
  getSupportedWallets,
  loadPersistedWallet,
  resetKit,
} from "@/lib/wallets/walletKit";
import { connectAndRegister } from "@/lib/client/walletClient";
import { getWalletErrorMessage } from "@/lib/wallets/errors";

interface UseWalletReturn {
  /** Current wallet state */
  wallet: WalletState;
  /** Whether wallet connection is in progress */
  connecting: boolean;
  /** Last connection error, if any */
  error: string | null;
  /** Connect to a wallet by ID */
  connect: (walletId: string) => Promise<void>;
  /** Disconnect and clear wallet state */
  disconnect: () => void;
  /** Re-check which wallets are available */
  refreshWallets: () => void;
}

/**
 * Hook for managing wallet connection state.
 * Handles auto-reconnection from persisted wallet data.
 */
export function useWallet(): UseWalletReturn {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    publicKey: null,
    network: "UNKNOWN",
    walletId: null,
    walletName: null,
    isAnyWalletInstalled: false,
    availableWallets: [],
  });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialise wallet detection and auto-reconnect
  useEffect(() => {
    setWallet((prev) => ({
      ...prev,
      isAnyWalletInstalled: checkAnyWalletInstalled(),
      availableWallets: getSupportedWallets(),
    }));

    const persisted = loadPersistedWallet();
    if (persisted) {
      setConnecting(true);
      setError(null);
      connectWithWallet(persisted.walletId)
        .then(async (result) => {
          setWallet((prev) => ({
            ...prev,
            connected: true,
            publicKey: result.publicKey,
            network: result.network,
            walletId: result.walletId,
            walletName: result.walletName,
          }));
          // Backend registration is best-effort on reconnect: if it fails,
          // the wallet is still connected and usable client-side, so we must
          // NOT clear the persisted session (which would force the user to
          // re-approve the wallet on every page load). The session TTL will
          // simply pick the wallet up on the next explicit connect.
          try {
            await connectAndRegister(result.publicKey, result.walletId, result.walletName);
          } catch {
            setError("Connected, but the session couldn't be registered with the server.");
          }
        })
        .catch((err) => {
          // The wallet itself rejected or failed to reconnect — clear the
          // stale persisted session and tell the user why instead of
          // silently dropping them on a disconnected screen.
          clearPersistedWallet();
          setError(getWalletErrorMessage(err));
        })
        .finally(() => setConnecting(false));
    }
  }, []);

  const connect = useCallback(async (walletId: string) => {
    setConnecting(true);
    setError(null);
    try {
      const result = await connectWithWallet(walletId);
      setWallet((prev) => ({
        ...prev,
        connected: true,
        publicKey: result.publicKey,
        network: result.network,
        walletId: result.walletId,
        walletName: result.walletName,
      }));
      await connectAndRegister(result.publicKey, result.walletId, result.walletName);
    } catch (err) {
      setError(getWalletErrorMessage(err));
      // Intentionally do NOT rethrow: callers that fail to catch would get an
      // unhandled promise rejection, and the error is already surfaced via
      // state (and returned as a boolean for programmatic use).
      return;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    clearPersistedWallet();
    resetKit();
    setWallet((prev) => ({
      ...prev,
      connected: false,
      publicKey: null,
      walletId: null,
      walletName: null,
      network: "UNKNOWN",
    }));
    setError(null);
  }, []);

  const refreshWallets = useCallback(() => {
    setWallet((prev) => ({
      ...prev,
      isAnyWalletInstalled: checkAnyWalletInstalled(),
      availableWallets: getSupportedWallets(),
    }));
  }, []);

  return { wallet, connecting, error, connect, disconnect, refreshWallets };
}

/** Re-export wallet types for convenience */
export type { WalletState, SupportedWallet };
