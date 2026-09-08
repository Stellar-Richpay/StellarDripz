/**
 * LOBSTR wallet connector.
 * Connects, signs, and signs messages via @lobstrco/signer-extension-api.
 */
import type { NetworkType } from "@/types/stellar";
import { STELLAR_NETWORK } from "../stellar/network";
import { storageSetJSON } from "../storage";

function persistWallet(wallet: {
  publicKey: string;
  walletId: string;
  walletName: string;
  connectedAt: number;
}): void {
  // Same key + guards as the other connectors, via the shared storage
  // helper — a local copy of this logic drifted here and duplicated the
  // try/catch dance (and any future hardening) from walletKit.
  storageSetJSON("stellardripz_wallet", wallet);
}

/**
 * Check for the LOBSTR extension object in window.
 * Deliberately NOT cached: browser extensions inject their object after page
 * scripts run, so a result computed on first paint can be a false negative
 * that persists until reload. Re-checking on every call is cheap and matches
 * how Freighter/xBull detection behaves.
 */
export function isLobstrInstalled(): boolean {
  try {
    return (
      typeof window !== "undefined" && ("lobstrSignerExtension" in window || "lobstr" in window)
    );
  } catch {
    return false;
  }
}

export async function connectLobstr(
  walletId: string,
  walletName: string,
): Promise<{
  publicKey: string;
  network: NetworkType;
  walletId: string;
  walletName: string;
}> {
  try {
    const { isConnected, getPublicKey } = await import("@lobstrco/signer-extension-api");

    const connected = await isConnected();
    if (!connected) throw new Error("LOBSTR_NOT_CONNECTED");

    const publicKey = await getPublicKey();
    if (!publicKey) throw new Error("NO_ACCOUNT");

    persistWallet({ publicKey, walletId, walletName, connectedAt: Date.now() });
    // Report the app's configured network (not a hardcoded testnet) so the
    // wallet/app mismatch guard behaves correctly on mainnet deployments.
    return { publicKey, network: STELLAR_NETWORK.network, walletId, walletName };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("reject") || msg.includes("denied") || msg.includes("cancel"))
      throw new Error("USER_REJECTED");
    if (msg.includes("not_connected") || msg.includes("not installed"))
      throw new Error("LOBSTR_NOT_DETECTED");
    throw new Error("LOBSTR_CONNECTION_FAILED");
  }
}

export async function signLobstr(xdr: string): Promise<string> {
  try {
    const { signTransaction } = await import("@lobstrco/signer-extension-api");

    const result = await signTransaction(xdr);

    // API may return { signedTxXdr } or the signed XDR string directly
    if (typeof result === "string") return result;
    if (result && typeof result === "object" && "signedTxXdr" in result) {
      return (result as { signedTxXdr: string }).signedTxXdr;
    }
    if (result && typeof result === "object" && "signedEnvelopeXdr" in result) {
      return (result as { signedEnvelopeXdr: string }).signedEnvelopeXdr;
    }
    throw new Error("LOBSTR_SIGN_FAILED");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("reject") || msg.includes("denied") || msg.includes("cancel"))
      throw new Error("USER_REJECTED");
    throw new Error("LOBSTR_SIGN_FAILED");
  }
}
