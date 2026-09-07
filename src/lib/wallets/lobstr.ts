/**
 * LOBSTR wallet connector.
 * Connects, signs, and signs messages via @lobstrco/signer-extension-api.
 */
import type { NetworkType } from "@/types/stellar";

function persistWallet(wallet: {
  publicKey: string;
  walletId: string;
  walletName: string;
  connectedAt: number;
}): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("stellardripz_wallet", JSON.stringify(wallet));
  } catch {
    /* blocked */
  }
}

/** Cached synchronous detection result. */
let _lobstrInstalled: boolean | null = null;

export function isLobstrInstalled(): boolean {
  if (_lobstrInstalled !== null) return _lobstrInstalled;
  try {
    // Check for the LOBSTR extension object in window
    _lobstrInstalled =
      typeof window !== "undefined" && ("lobstrSignerExtension" in window || "lobstr" in window);
  } catch {
    _lobstrInstalled = false;
  }
  return _lobstrInstalled ?? false;
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
    return { publicKey, network: "TESTNET", walletId, walletName };
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
