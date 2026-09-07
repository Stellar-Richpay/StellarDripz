"use client";

import { useAppContext } from "@/context/AppContext";
import { STELLAR_NETWORK } from "@/lib/stellar/network";

/**
 * Site header. The network badge shows the configured Stellar network
 * (from env) and, once a wallet is connected, warns when the wallet is on
 * a different network than the dApp — the #1 support issue for faucets.
 */
export default function Header() {
  const { state } = useAppContext();
  const { wallet } = state;

  const appNetwork = STELLAR_NETWORK.network;
  const walletNetwork = wallet.connected ? wallet.network : null;

  const networkMismatch =
    wallet.connected && walletNetwork !== "UNKNOWN" && walletNetwork !== appNetwork;

  const badgeLabel = networkMismatch
    ? `Wallet on ${walletNetwork}`
    : appNetwork === "MAINNET"
      ? "Mainnet"
      : "Stellar Testnet";

  return (
    <header className="relative z-10 w-full border-b border-white/5 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-stellar-blue to-stellar-purple shadow-lg shadow-stellar-blue/25">
            <span className="text-xl">💧</span>
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-drip rounded-full bg-stellar-blue/60" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Stellar<span className="text-stellar-blue">Dripz</span>
            </h1>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
              {appNetwork === "MAINNET" ? "Stellar Mainnet" : "Testnet Faucet"}
            </p>
          </div>
        </div>

        {/* Network badge — reflects the real network and flags mismatches */}
        <div
          role="status"
          className={`hidden sm:flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
            networkMismatch
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-white/10 bg-white/5 text-white/50"
          }`}
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                networkMismatch ? "bg-red-500" : "bg-stellar-green"
              }`}
            />
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                networkMismatch ? "bg-red-500" : "bg-stellar-green"
              }`}
            />
          </span>
          {badgeLabel}
        </div>
      </div>
    </header>
  );
}
