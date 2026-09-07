/**
 * Multi-wallet abstraction layer.
 * Provides a unified interface for connecting/signing with multiple Stellar wallets.
 */
import { STELLAR_NETWORK } from "../stellar/network";
import { connectFreighter, signFreighter } from "./freighter";
import { connectLobstr, signLobstr, isLobstrInstalled } from "./lobstr";
import {
  isWalletConnectAvailable,
  startWalletConnectPairing,
  connectWalletConnect,
  signWalletConnect,
  disconnectWalletConnect,
} from "./walletconnect";
import { storageGetJSON, storageRemove, storageSetJSON } from "../storage";
import type { NetworkType, SupportedWallet } from "@/types/stellar";

// ---- Wallet Registry ----

const WALLET_REGISTRY: {
  id: string;
  name: string;
  iconUrl: string;
  installUrl: string;
  checkInstalled: () => boolean;
}[] = [
  {
    id: "freighter",
    name: "Freighter",
    iconUrl: "🦊",
    installUrl: "https://www.freighter.app/",
    checkInstalled: () => typeof window !== "undefined" && "freighterApi" in window,
  },
  {
    id: "xbull",
    name: "xBull",
    iconUrl: "🐂",
    installUrl: "https://xbull.app/",
    checkInstalled: () => typeof window !== "undefined" && "xBullSDK" in window,
  },
  {
    id: "albedo",
    name: "Albedo",
    iconUrl: "☀️",
    installUrl: "https://albedo.link/",
    checkInstalled: () => true,
  },
  {
    id: "lobstr",
    name: "LOBSTR",
    iconUrl: "🐙",
    installUrl: "https://lobstr.co/",
    checkInstalled: () => isLobstrInstalled(),
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    iconUrl: "📱",
    installUrl: "https://walletconnect.com/",
    checkInstalled: () => isWalletConnectAvailable(),
  },
];

export function getSupportedWallets(): SupportedWallet[] {
  return WALLET_REGISTRY.map((w) => ({
    id: w.id,
    name: w.name,
    iconUrl: w.iconUrl,
    installed: w.checkInstalled(),
  }));
}

export function checkAnyWalletInstalled(): boolean {
  return WALLET_REGISTRY.some((w) => w.checkInstalled());
}

// ---- Storage ----

const STORAGE_KEY = "stellardripz_wallet";

interface StoredWallet {
  publicKey: string;
  walletId: string;
  walletName: string;
  connectedAt: number;
}

export function persistWallet(wallet: StoredWallet): void {
  storageSetJSON(STORAGE_KEY, wallet);
}

export function loadPersistedWallet(): StoredWallet | null {
  if (typeof window === "undefined") return null;
  const parsed = storageGetJSON<StoredWallet>(STORAGE_KEY);
  if (!parsed?.publicKey || !parsed.walletId) return null;
  if (Date.now() - parsed.connectedAt > 24 * 60 * 60 * 1000) {
    clearPersistedWallet();
    return null;
  }
  return parsed;
}

export function clearPersistedWallet(): void {
  storageRemove(STORAGE_KEY);
  storageRemove("stellardripz_wc_topic");
  disconnectWalletConnect().catch(() => {});
  _wcPairing = null;
}

/** Reset the wallet kit state — clears all tracked connections without localStorage. */
export function resetKit(): void {
  // Wallet connections are ephemeral; persistent data is cleared via clearPersistedWallet().
  // This hook exists for symmetry with disconnect() and future wallet state management.
}

/**
 * Check if the currently connected wallet is still accessible.
 * Returns false if the user disconnected from the wallet extension.
 */
export async function checkWalletStillConnected(): Promise<boolean> {
  const persisted = loadPersistedWallet();
  if (!persisted) return false;

  // For Freighter: try a lightweight call to verify connection
  if (persisted.walletId === "freighter") {
    try {
      const { isConnected } = await import("@stellar/freighter-api");
      const { isConnected: connected } = await isConnected();
      return connected;
    } catch {
      return false;
    }
  }

  // For LOBSTR: check via the extension API
  if (persisted.walletId === "lobstr") {
    try {
      const { isConnected } = await import("@lobstrco/signer-extension-api");
      return await isConnected();
    } catch {
      return false;
    }
  }

  // For WalletConnect: check if session still exists
  if (persisted.walletId === "walletconnect") {
    const { reconnectWalletConnect } = await import("./walletconnect");
    const reconnected = await reconnectWalletConnect();
    return reconnected !== null;
  }

  // For other wallets, assume connected if recently used (< 5 min)
  return Date.now() - persisted.connectedAt < 5 * 60 * 1000;
}

// ---- Connection ----

export async function connectWithWallet(walletId: string): Promise<{
  publicKey: string;
  network: NetworkType;
  walletId: string;
  walletName: string;
}> {
  const wallet = WALLET_REGISTRY.find((w) => w.id === walletId);
  if (!wallet) throw new Error("UNSUPPORTED_WALLET");
  if (!wallet.checkInstalled()) throw new Error("WALLET_NOT_INSTALLED");

  switch (walletId) {
    case "freighter":
      return connectFreighter(walletId, wallet.name);
    case "xbull":
      return connectXBull(walletId, wallet.name);
    case "albedo":
      return connectAlbedo(walletId, wallet.name);
    case "lobstr":
      return connectLobstr(walletId, wallet.name);
    case "walletconnect":
      return connectWalletConnectFlow(walletId, wallet.name);
    default:
      throw new Error(`Wallet "${wallet.name}" is not yet fully integrated. Please use Freighter.`);
  }
}

async function connectXBull(
  walletId: string,
  walletName: string,
): Promise<{
  publicKey: string;
  network: NetworkType;
  walletId: string;
  walletName: string;
}> {
  const xbull = (window as unknown as Record<string, Record<string, unknown>>).xBullSDK;
  if (!xbull?.connect) throw new Error("XBULL_NOT_DETECTED");
  try {
    const pubkey = await (xbull.connect as () => Promise<string>)();
    if (!pubkey) throw new Error("NO_ACCOUNT");
    persistWallet({ publicKey: pubkey, walletId, walletName, connectedAt: Date.now() });
    // Report the app's configured network, not a hardcoded testnet: a
    // mainnet deployment that reported TESTNET would trip the wallet/app
    // mismatch guard and block every legitimate send.
    return { publicKey: pubkey, network: STELLAR_NETWORK.network, walletId, walletName };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("reject") || msg.includes("denied")) throw new Error("USER_REJECTED");
    throw new Error("XBULL_CONNECTION_FAILED");
  }
}

async function connectAlbedo(
  walletId: string,
  walletName: string,
): Promise<{
  publicKey: string;
  network: NetworkType;
  walletId: string;
  walletName: string;
}> {
  try {
    const albedo = await import("@albedo-link/intent");
    const result = await albedo.default.publicKey({});
    if (!result.pubkey) throw new Error("NO_ACCOUNT");
    persistWallet({ publicKey: result.pubkey, walletId, walletName, connectedAt: Date.now() });
    // Report the app's configured network (not a hardcoded testnet) so the
    // wallet/app mismatch guard behaves correctly on mainnet deployments.
    return { publicKey: result.pubkey, network: STELLAR_NETWORK.network, walletId, walletName };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("reject") || msg.includes("denied") || msg.includes("closed"))
      throw new Error("USER_REJECTED");
    throw new Error("ALBEDO_CONNECTION_FAILED");
  }
}

// ---- WalletConnect Pairing ----

/**
 * Max time a user has to scan the QR and approve the WalletConnect session.
 * Prevents connect() from hanging forever (and the UI from showing an
 * endless "Connecting..." spinner) when the user never scans or the mobile
 * wallet never responds.
 */
const WC_PAIRING_TIMEOUT_MS = 120_000;

let _wcPairing: Awaited<ReturnType<typeof startWalletConnectPairing>> | null = null;

/** Race a promise against a timeout; rejects with `code` if it expires. */
function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Get the current WalletConnect pairing URI for QR display. */
export function getWalletConnectPairingUri(): string | null {
  return _wcPairing?.uri || null;
}

/** Clear the current WalletConnect pairing state. */
export function clearWalletConnectPairing(): void {
  _wcPairing = null;
}

async function connectWalletConnectFlow(
  walletId: string,
  walletName: string,
): Promise<{
  publicKey: string;
  network: NetworkType;
  walletId: string;
  walletName: string;
}> {
  if (!isWalletConnectAvailable()) throw new Error("WC_NO_PROJECT_ID");

  _wcPairing = await startWalletConnectPairing();

  try {
    const result = await withTimeout(
      connectWalletConnect(walletId, walletName, _wcPairing),
      WC_PAIRING_TIMEOUT_MS,
      "WC_TIMEOUT",
    );
    _wcPairing = null;
    return result;
  } catch (err) {
    _wcPairing = null;
    throw err;
  }
}

// ---- Signing ----

export async function signTx(xdr: string, publicKey: string): Promise<string> {
  const persisted = loadPersistedWallet();
  // Never silently default to Freighter: signing with the wrong wallet would
  // either fail confusingly or — worse — sign with a wallet the user did not
  // choose. Require an explicit, persisted connection.
  const walletId = persisted?.walletId;
  if (!walletId) {
    throw new Error("NO_WALLET_CONNECTED");
  }

  switch (walletId) {
    case "freighter":
      return signFreighter(xdr);
    case "xbull": {
      const xbull = (window as unknown as Record<string, Record<string, unknown>>).xBullSDK;
      if (!xbull?.sign) throw new Error("xBull signing not available");
      const signed = await (
        xbull.sign as (xdr: string, opts: Record<string, unknown>) => Promise<{ signedXdr: string }>
      )(xdr, {
        networkPassphrase: STELLAR_NETWORK.networkPassphrase,
      });
      return signed.signedXdr;
    }
    case "albedo": {
      const albedo = await import("@albedo-link/intent");
      // Albedo signs against a network passphrase chosen by its `network`
      // param — sign against the app's configured network so a mainnet
      // deployment doesn't produce testnet-signed transactions.
      const albedoNetwork = STELLAR_NETWORK.network === "MAINNET" ? "mainnet" : "testnet";
      const result = await albedo.default.tx({ xdr, network: albedoNetwork });
      return result.signed_envelope_xdr;
    }
    case "lobstr":
      return signLobstr(xdr);
    case "walletconnect":
      return signWalletConnect(xdr);
    default:
      throw new Error(`Signing not supported for wallet: ${walletId}`);
  }
}
