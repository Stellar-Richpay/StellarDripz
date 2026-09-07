"use client";

import { useState, useEffect, useRef } from "react";
import { useAppContext } from "@/context/AppContext";
import QrModal from "./QrModal";
import QRFundModal from "./QRFundModal";
import type { SupportedWallet } from "@/types/stellar";
import {
  getSupportedWallets,
  getWalletConnectPairingUri,
  clearWalletConnectPairing,
} from "@/lib/wallets/walletKit";
import { getWalletErrorMessage } from "@/lib/wallets/errors";

/** Resolve the icon for a connected wallet ID from the registry. */
function walletIcon(id: string | null): string {
  if (!id) return "🔑";
  const wallet = getSupportedWallets().find((w) => w.id === id);
  return wallet?.iconUrl || "🔑";
}

/**
 * Multi-wallet selector component.
 * Supports browser extensions (Freighter, xBull, LOBSTR), web wallet (Albedo),
 * and mobile QR pairing via WalletConnect.
 */
export default function WalletConnect() {
  const { state, connect, disconnect } = useAppContext();
  const { wallet } = state;
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // ── WalletConnect QR state ──────────────────────────────────────
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [showWcQr, setShowWcQr] = useState(false);
  const wcPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Keyboard dismiss ────────────────────────────────────────────

  useEffect(() => {
    if (!showPicker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowPicker(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPicker]);

  // ── WalletConnect pairing URI poll ──────────────────────────────

  const startWcPoll = () => {
    wcPollRef.current = setInterval(() => {
      const uri = getWalletConnectPairingUri();
      if (uri) {
        setWcUri(uri);
        setShowWcQr(true);
        stopWcPoll();
      }
    }, 300);
  };

  const stopWcPoll = () => {
    if (wcPollRef.current) {
      clearInterval(wcPollRef.current);
      wcPollRef.current = null;
    }
  };

  // Clean up on unmount
  useEffect(() => () => stopWcPoll(), []);

  // Clean up WC state on disconnect
  useEffect(() => {
    if (!wallet.connected) {
      setWcUri(null);
      setShowWcQr(false);
      stopWcPoll();
    }
  }, [wallet.connected]);

  // ── Connection handler ──────────────────────────────────────────

  const handleConnect = async (walletId: string) => {
    setConnecting(true);
    setError(null);
    setShowPicker(false);

    if (walletId === "walletconnect") {
      startWcPoll();
    }

    try {
      await connect(walletId);
    } catch (err) {
      setError(getWalletErrorMessage(err));
    } finally {
      setConnecting(false);
      stopWcPoll();
    }
  };

  const handleCancelWc = () => {
    stopWcPoll();
    clearWalletConnectPairing();
    setWcUri(null);
    setShowWcQr(false);
    setConnecting(false);
    setError(null);
  };

  // ── Copy ────────────────────────────────────────────────────────

  const handleCopy = async () => {
    if (!wallet.publicKey) return;
    try {
      await navigator.clipboard.writeText(wallet.publicKey);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = wallet.publicKey;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Connected state ─────────────────────────────────────────────

  if (wallet.connected && wallet.publicKey) {
    return (
      <>
        <QrModal
          open={showQr}
          onClose={() => setShowQr(false)}
          address={wallet.publicKey}
          label="Wallet Address"
        />
        <div className="rounded-2xl border border-stellar-green/20 bg-surface-800/60 p-6 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stellar-green/10 text-lg">
                {walletIcon(wallet.walletId)}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  {wallet.walletName || "Connected"}
                </p>
                <p className="font-mono text-xs text-stellar-green truncate max-w-[200px]">
                  {wallet.publicKey.slice(0, 8)}...{wallet.publicKey.slice(-6)}
                </p>
              </div>
            </div>
            <button
              onClick={disconnect}
              className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 active:scale-95"
            >
              Disconnect
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/60 hover:bg-white/10"
            >
              {copied ? "✅ Copied!" : "📋 Copy"}
            </button>
            <button
              onClick={() => setShowQr(true)}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/60 hover:bg-white/10"
            >
              📱 QR
            </button>
            <QRFundModal address={wallet.publicKey} />
          </div>
        </div>
      </>
    );
  }

  // ── Disconnected state ──────────────────────────────────────────

  const wallets =
    wallet.availableWallets.length > 0 ? wallet.availableWallets : getSupportedWallets();

  return (
    <div className="rounded-2xl border border-white/10 bg-surface-800/60 p-6 backdrop-blur-md text-center">
      {/* ── WalletConnect QR Modal ────────────────────────────────── */}
      {showWcQr && wcUri && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleCancelWc}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-stellar-blue/20 bg-surface-800 p-6 shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                📱 Scan with WalletConnect
              </h3>
              <button
                onClick={handleCancelWc}
                className="text-white/40 hover:text-white/80"
              >
                ✕
              </button>
            </div>

            {/* QR Code */}
            <div className="mb-4 flex justify-center">
              <div className="rounded-2xl bg-white p-4">
                {/* qrcode.react is already a project dependency */}
                <WCQrCode uri={wcUri} />
              </div>
            </div>

            <p className="mb-4 text-sm text-white/60">
              Open your Stellar mobile wallet (LOBSTR, xBull, etc.), tap{" "}
              <strong>WalletConnect</strong>, and scan this QR code.
            </p>

            <div className="flex items-center justify-center gap-2 text-sm text-stellar-blue">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-stellar-blue/30 border-t-stellar-blue" />
              Waiting for connection...
            </div>

            <button
              onClick={handleCancelWc}
              className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/40 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Wallet Picker Modal ───────────────────────────────────── */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowPicker(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-surface-800 p-6 shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Choose Wallet</h3>
              <button
                onClick={() => setShowPicker(false)}
                className="text-white/40 hover:text-white/80"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {wallets.map((w: SupportedWallet) => (
                <button
                  key={w.id}
                  onClick={() => handleConnect(w.id)}
                  disabled={connecting}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10 hover:border-stellar-blue/30 active:scale-[0.98] disabled:opacity-50"
                >
                  <span className="text-2xl">{w.iconUrl || "🔑"}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">{w.name}</p>
                    <p className="text-[10px] text-white/40">
                      {w.installed ? "Available" : "Not detected"}
                    </p>
                  </div>
                  <span className="text-white/20">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Main connect card ─────────────────────────────────────── */}
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-stellar-blue/10">
        <svg
          className="h-8 w-8 text-stellar-blue"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">Connect Wallet</h2>
      <p className="mb-4 text-sm text-white/60 max-w-xs mx-auto">
        Link any Stellar wallet to get testnet XLM, send assets, and interact with smart
        contracts.
      </p>

      {error && (
        <p className="mb-3 text-sm text-red-400 bg-red-500/5 rounded-lg py-2 px-3 border border-red-500/20">
          {error}
        </p>
      )}

      <button
        onClick={() => setShowPicker(true)}
        disabled={connecting}
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-stellar-blue to-stellar-purple px-6 py-3 text-sm font-semibold text-white hover:shadow-lg active:scale-95 disabled:opacity-50"
      >
        {connecting ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Connecting...
          </>
        ) : (
          "Connect Wallet"
        )}
      </button>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {wallets.map((w: SupportedWallet) => (
          <span
            key={w.id}
            className="inline-flex items-center gap-1 rounded-full border border-white/5 bg-white/[0.02] px-2.5 py-1 text-[10px] text-white/30"
          >
            <span className="text-xs">{w.iconUrl || "🔑"}</span>
            {w.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Lightweight QR code renderer using qrcode.react.
 * Wrapped to avoid SSR issues (qrcode.react requires canvas/DOM).
 */
function WCQrCode({ uri }: { uri: string }) {
  const [QrCode, setQrCode] = useState<React.ElementType | null>(null);

  useEffect(() => {
    import("qrcode.react").then((mod) => setQrCode(() => mod.QRCodeSVG));
  }, []);

  if (!QrCode) {
    return (
      <div className="flex h-56 w-56 items-center justify-center text-white/20 text-sm">
        Loading QR...
      </div>
    );
  }

  return <QrCode value={uri} size={224} />;
}
