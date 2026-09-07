"use client";

import { useAppContext } from "@/context/AppContext";
import { STELLAR_NETWORK } from "@/lib/stellar/network";

export default function NetworkWarning() {
  const { state } = useAppContext();
  const { wallet } = state;

  const appNetwork = STELLAR_NETWORK.network;

  // No wallet, or wallet network matches the app — nothing to warn about.
  if (!wallet.connected || wallet.network === "UNKNOWN" || wallet.network === appNetwork) {
    return null;
  }

  const walletLabel =
    wallet.network === "MAINNET"
      ? "Mainnet"
      : wallet.network === "TESTNET"
        ? "Testnet"
        : wallet.network;
  const appLabel = appNetwork === "MAINNET" ? "Mainnet" : "Testnet";

  return (
    <div
      role="alert"
      className="mx-auto mb-6 max-w-2xl rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-center backdrop-blur-sm"
    >
      <div className="flex items-center justify-center gap-2">
        <span className="text-lg">⚠️</span>
        <p className="text-sm font-medium text-red-400">
          Your wallet is on <strong>{walletLabel}</strong>. Please switch to{" "}
          <strong>{appLabel}</strong> in your wallet extension settings.
        </p>
      </div>
    </div>
  );
}
// NetworkWarning: flags when the wallet network mismatches the app network
