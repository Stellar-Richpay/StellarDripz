"use client";

import { useState, useCallback } from "react";
import { useAppContext } from "@/context/AppContext";
import { directSimulateContract } from "@/lib/client/directClient";
import { useContractEvents } from "@/hooks/useContractEvents";
import { getContractExplorerUrl } from "@/lib/stellar/explorer";
import { getNetworkState } from "@/lib/stellar/networkGuard";
import * as StellarSdk from "@stellar/stellar-sdk";
import { buildContractCall, submitContract } from "@/lib/client/apiClient";
import { signTx } from "@/lib/wallets/walletKit";
import { memoByteLength } from "@/lib/stellar/memo";
import { showToast } from "./Toast";

interface SorobanDemoProps {
  contractId: string;
}

/**
 * Soroban smart contract demo.
 * Reads use direct Soroban RPC (low latency).
 * Writes go through the API proxy (rate-limited, logged).
 */
export default function SorobanDemo({ contractId }: SorobanDemoProps) {
  const { state, addContractEvent } = useAppContext();
  const [counter, setCounter] = useState<number | null>(null);
  const [greeting, setGreeting] = useState("");
  const [newGreeting, setNewGreeting] = useState("");
  const [loading, setLoading] = useState(false);

  // State-changing contract calls must not fire from a wallet on a different
  // network than the app (matching the Send guard). On a mainnet deployment a
  // mainnet wallet is correct, so this is a mismatch check, not a hardcoded
  // "mainnet is wrong".
  const { mismatch: isNetworkMismatch, appLabel } = getNetworkState(state.wallet.network);

  // Live contract events (SSE with direct RPC polling fallback).
  const {
    events: contractEvents,
    connected: eventsConnected,
    error: eventsError,
    clearEvents,
  } = useContractEvents({ contractId, enabled: true });

  // ---- Direct read: get counter ---- //
  const handleGetCounter = useCallback(async () => {
    if (!state.wallet.publicKey) return;
    setLoading(true);
    try {
      const { resultValue } = await directSimulateContract(
        contractId,
        "get_global",
        [],
        state.wallet.publicKey,
      );
      setCounter(resultValue ? parseInt(resultValue, 10) : 0);
    } catch (err) {
      showToast({
        type: "error",
        title: "Read failed",
        message: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [state.wallet.publicKey, contractId]);

  // ---- Proxied write: increment counter ---- //
  const handleIncrement = useCallback(async () => {
    if (!state.wallet.publicKey || isNetworkMismatch) return;
    setLoading(true);
    try {
      const address = state.wallet.publicKey;
      const { xdr } = await buildContractCall(contractId, "increment", [address], address);
      const signedXdr = await signTx(xdr, address);
      const { hash, resultValue } = await submitContract(
        signedXdr,
        contractId,
        "increment",
        address,
      );

      setCounter(resultValue ? parseInt(resultValue, 10) : (counter || 0) + 1);
      showToast({ type: "success", title: "Incremented!", message: `TX: ${hash.slice(0, 10)}...` });
    } catch (err) {
      showToast({
        type: "error",
        title: "Increment failed",
        message: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [state.wallet.publicKey, contractId, counter, isNetworkMismatch]);

  // ---- Direct read: get greeting ---- //
  const handleGetGreeting = useCallback(async () => {
    if (!state.wallet.publicKey) return;
    setLoading(true);
    try {
      const { resultValue } = await directSimulateContract(
        contractId,
        "get_greeting",
        [new StellarSdk.Address(state.wallet.publicKey).toScVal()],
        state.wallet.publicKey,
      );
      setGreeting((resultValue as string) || "Hello from StellarDripz!");
    } catch (err) {
      // The read failed — surface why instead of silently resetting to the
      // default, which previously made every failure look like "no greeting".
      setGreeting("");
      showToast({
        type: "error",
        title: "Read failed",
        message: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [state.wallet.publicKey, contractId]);

  // The counter contract rejects greetings over 512 bytes; enforce the same
  // cap here (in bytes, not characters) so an oversized message is caught
  // before the user approves a wallet prompt that can only fail.
  const greetingTooLong = memoByteLength(newGreeting) > 512;

  // ---- Proxied write: set greeting ---- //
  const handleSetGreeting = useCallback(async () => {
    if (!state.wallet.publicKey || !newGreeting.trim() || isNetworkMismatch) return;
    setLoading(true);
    try {
      const address = state.wallet.publicKey;
      const { xdr } = await buildContractCall(
        contractId,
        "set_greeting",
        [address, newGreeting.trim()],
        address,
      );
      const signedXdr = await signTx(xdr, address);
      await submitContract(signedXdr, contractId, "set_greeting", address);

      setGreeting(newGreeting.trim());
      setNewGreeting("");
      showToast({ type: "success", title: "Greeting updated!", message: newGreeting.trim() });
    } catch (err) {
      showToast({
        type: "error",
        title: "Set greeting failed",
        message: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [state.wallet.publicKey, contractId, newGreeting, isNetworkMismatch]);

  return (
    <div className="space-y-4 rounded-2xl border border-stellar-purple/20 bg-surface-800/60 p-5 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stellar-purple/10 text-sm">
          📜
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Soroban Demo</h3>
          <a
            href={getContractExplorerUrl(contractId)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] text-white/30 hover:text-stellar-blue transition-colors"
            title="Open contract on StellarExpert"
          >
            {contractId.slice(0, 12)}... ↗
          </a>
        </div>
      </div>

      {isNetworkMismatch && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          ⚠️ Wallet on wrong network — switch to {appLabel} to use contracts.
        </div>
      )}

      {/* Counter */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/30">Counter</p>
            <p className="text-xl font-bold text-white">{counter !== null ? counter : "—"}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleGetCounter}
              disabled={loading}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60 hover:bg-white/10 disabled:opacity-50"
            >
              Read
            </button>
            <button
              onClick={handleIncrement}
              disabled={loading || isNetworkMismatch}
              className="rounded-lg bg-gradient-to-r from-stellar-purple to-stellar-blue px-3 py-1.5 text-xs font-semibold text-white hover:shadow-lg active:scale-95 disabled:opacity-50"
            >
              +1
            </button>
          </div>
        </div>
      </div>
      {/* Greeting */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[10px] text-white/30 mb-1">Greeting</p>
        <p className="text-sm text-white mb-2">{greeting || "—"}</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newGreeting}
            onChange={(e) => setNewGreeting(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSetGreeting()}
            placeholder="New greeting..."
            aria-label="New greeting (max 512 bytes)"
            aria-invalid={greetingTooLong}
            disabled={loading || isNetworkMismatch}
            className="flex-1 rounded-lg border border-white/10 bg-surface-950 px-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-stellar-purple/50 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSetGreeting}
            disabled={loading || !newGreeting.trim() || isNetworkMismatch || greetingTooLong}
            className="rounded-lg border border-stellar-purple/30 bg-stellar-purple/10 px-3 py-1.5 text-xs font-medium text-stellar-purple hover:bg-stellar-purple/20 disabled:opacity-30"
          >
            Set
          </button>
          {greetingTooLong && (
            <p className="mt-1 text-[10px] text-red-400" role="alert">
              Greeting exceeds the 512-byte contract limit.
            </p>
          )}
          <button
            onClick={handleGetGreeting}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60 hover:bg-white/10 disabled:opacity-50"
          >
            Read
          </button>
        </div>
      </div>

      {/* Live events */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] text-white/30">Live Events</p>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 text-[10px] ${
                eventsConnected ? "text-stellar-green" : "text-yellow-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  eventsConnected ? "bg-stellar-green" : "bg-yellow-400 animate-pulse"
                }`}
              />
              {eventsConnected ? "live" : "connecting…"}
            </span>
            {contractEvents.length > 0 && (
              <button
                onClick={clearEvents}
                className="text-[10px] text-white/30 hover:text-white/70 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {eventsError && <p className="text-[10px] text-yellow-400/80 mb-1">{eventsError}</p>}
        {contractEvents.length === 0 ? (
          <p className="text-[10px] text-white/20 py-1">
            No events yet — increment the counter or set a greeting to see one.
          </p>
        ) : (
          <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {contractEvents.slice(0, 20).map((evt) => (
              <li
                key={evt.id}
                className="flex items-start gap-2 rounded-lg bg-white/[0.02] px-2 py-1"
              >
                <span className="text-[10px]">⚡</span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] text-stellar-purple/80 break-all">
                    {evt.topic || "event"}
                  </p>
                  <p className="font-mono text-[10px] text-white/50 break-all">{evt.value}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
