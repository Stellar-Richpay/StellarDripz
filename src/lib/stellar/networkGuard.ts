import { STELLAR_NETWORK } from "@/lib/stellar/network";

/**
 * Wallet network state relative to the app's configured network.
 *
 * The app can run against testnet or mainnet (via env), so guards must
 * compare the wallet network to the app network rather than hardcoding
 * "mainnet is wrong" — on a mainnet deployment a mainnet wallet is
 * correct and a testnet wallet is the mismatch.
 */
export interface NetworkState {
  /** True when the wallet's network differs from the app's network. */
  mismatch: boolean;
  /** True when the wallet's network matches the app's (or is unknown). */
  matches: boolean;
  /** Human label for the wallet's network, or null when unknown. */
  walletLabel: string | null;
  /** Human label for the app's network. */
  appLabel: string;
}

export function getNetworkState(walletNetwork: string | null | undefined): NetworkState {
  const appNetwork = STELLAR_NETWORK.network;
  const wallet = walletNetwork || "UNKNOWN";

  const walletLabel =
    wallet === "MAINNET"
      ? "Mainnet"
      : wallet === "TESTNET"
        ? "Testnet"
        : wallet === "UNKNOWN"
          ? null
          : wallet;
  const appLabel = appNetwork === "MAINNET" ? "Mainnet" : "Testnet";

  return {
    mismatch: wallet !== "UNKNOWN" && wallet !== appNetwork,
    matches: wallet === "UNKNOWN" || wallet === appNetwork,
    walletLabel,
    appLabel,
  };
}
