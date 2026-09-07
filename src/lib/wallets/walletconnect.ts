/**
 * WalletConnect connector for mobile wallet linking via QR code.
 * Uses @walletconnect/sign-client for session-based Stellar interactions.
 *
 * Connect flow:
 *   1. Init SignClient → propose session → get pairing URI (wc:...)
 *   2. Display URI as QR code (handled by WalletConnect.tsx component)
 *   3. Mobile wallet scans QR → approves session → returns public key
 *
 * Sign flow:
 *   client.request({ method: "stellar_signAndSubmitXdr", params: { xdr } })
 */
import SignClient from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import { STELLAR_NETWORK } from "../stellar/network";
import type { NetworkType } from "@/types/stellar";

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

const STELLAR_CHAIN = "stellar:testnet";
const SESSION_NAMESPACE = "stellar";

/** Stored session topic for reconnection. */
const TOPIC_KEY = "stellardripz_wc_topic";

let _client: SignClient | null = null;
let _activeSession: SessionTypes.Struct | null = null;

// ── Client lifecycle ──────────────────────────────────────────────

async function getClient(): Promise<SignClient> {
  if (_client) return _client;
  if (!PROJECT_ID) throw new Error("WC_NO_PROJECT_ID");

  _client = await SignClient.init({
    projectId: PROJECT_ID,
    metadata: {
      name: "StellarDripz",
      description: "Stellar testnet faucet & smart contract dApp",
      url: "https://stellardripz.vercel.app",
      icons: ["https://stellardripz.vercel.app/favicon.ico"],
    },
  });

  return _client;
}

// ── Detection ─────────────────────────────────────────────────────

/** WalletConnect is always available as a service (no extension needed). */
export function isWalletConnectAvailable(): boolean {
  return Boolean(PROJECT_ID);
}

/**
 * Return a human-readable status message about WalletConnect availability.
 * When the project ID is not configured, returns a helpful message for the UI
 * instead of silently hiding the option (audit finding W2).
 */
export function getWalletConnectStatus(): {
  available: boolean;
  message: string;
} {
  if (PROJECT_ID) {
    return { available: true, message: "Scan QR with your mobile wallet" };
  }
  return {
    available: false,
    message:
      "WalletConnect requires NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. Get one at https://cloud.reown.com",
  };
}

// ── Connection ────────────────────────────────────────────────────

export interface WCPairingInfo {
  /** The wc: URI to display as QR code */
  uri: string;
  /** Call after the user scans — resolves with session data or rejects */
  approval: () => Promise<{
    publicKey: string;
    topic: string;
  }>;
}

/**
 * Start the WalletConnect pairing flow.
 * Returns the pairing URI (for QR display) and an approval promise.
 */
export async function startWalletConnectPairing(): Promise<WCPairingInfo> {
  const client = await getClient();

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      [SESSION_NAMESPACE]: {
        methods: ["stellar_signAndSubmitXdr", "stellar_signXdr"],
        chains: [STELLAR_CHAIN],
        events: [],
      },
    },
  });

  if (!uri) throw new Error("WC_NO_URI");

  const approvalPromise = async (): Promise<{ publicKey: string; topic: string }> => {
    const session = await approval();

    // Extract the Stellar public key from the session
    const accounts = session.namespaces[SESSION_NAMESPACE]?.accounts || [];
    const stellarAccount = accounts.find((a) => a.startsWith(STELLAR_CHAIN));
    if (!stellarAccount) throw new Error("WC_NO_STELLAR_ACCOUNT");

    // Format: "stellar:testnet:GABCD..."
    const publicKey = stellarAccount.split(":").pop() || "";
    if (!publicKey) throw new Error("WC_NO_PUBLIC_KEY");

    _activeSession = session;

    // Persist topic for reconnection
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(TOPIC_KEY, session.topic);
      } catch {
        /* ignore */
      }
    }

    return { publicKey, topic: session.topic };
  };

  return { uri, approval: approvalPromise };
}

/**
 * Complete the WalletConnect connection after pairing is approved.
 */
export async function connectWalletConnect(
  walletId: string,
  walletName: string,
  pairing: WCPairingInfo,
): Promise<{
  publicKey: string;
  network: NetworkType;
  walletId: string;
  walletName: string;
}> {
  const { publicKey } = await pairing.approval();

  // Persist via localStorage (same key as other wallets)
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        "stellardripz_wallet",
        JSON.stringify({ publicKey, walletId, walletName, connectedAt: Date.now() }),
      );
    } catch {
      /* ignore */
    }
  }

  return { publicKey, network: "TESTNET", walletId, walletName };
}

// ── Reconnection ──────────────────────────────────────────────────

/**
 * Try to reconnect to an existing WalletConnect session.
 */
export async function reconnectWalletConnect(): Promise<{
  publicKey: string;
  walletId: string;
  walletName: string;
} | null> {
  if (!PROJECT_ID) return null;
  if (typeof window === "undefined") return null;

  const topic = localStorage.getItem(TOPIC_KEY);
  if (!topic) return null;

  try {
    const client = await getClient();
    const sessions = client.session.getAll();
    const session = sessions.find((s) => s.topic === topic);
    if (!session) {
      localStorage.removeItem(TOPIC_KEY);
      return null;
    }

    // Check if session is expired
    if (session.expiry && session.expiry * 1000 < Date.now()) {
      localStorage.removeItem(TOPIC_KEY);
      return null;
    }

    _activeSession = session;

    const accounts = session.namespaces[SESSION_NAMESPACE]?.accounts || [];
    const stellarAccount = accounts.find((a) => a.startsWith(STELLAR_CHAIN));
    if (!stellarAccount) return null;

    const publicKey = stellarAccount.split(":").pop() || "";
    if (!publicKey) return null;

    return { publicKey, walletId: "walletconnect", walletName: "WalletConnect" };
  } catch {
    return null;
  }
}

// ── Signing ───────────────────────────────────────────────────────

export async function signWalletConnect(xdr: string): Promise<string> {
  if (!_activeSession) {
    // Try to recover from stored topic
    const reconnected = await reconnectWalletConnect();
    if (!reconnected) throw new Error("WC_NOT_CONNECTED");
  }

  const client = await getClient();

  const result = await client.request<{ signedXdr: string }>({
    topic: _activeSession!.topic,
    request: {
      method: "stellar_signAndSubmitXdr",
      params: {
        xdr,
        networkPassphrase: STELLAR_NETWORK.networkPassphrase,
      },
    },
    chainId: STELLAR_CHAIN,
  });

  return result.signedXdr;
}

// ── Cleanup ───────────────────────────────────────────────────────

export async function disconnectWalletConnect(): Promise<void> {
  if (_activeSession) {
    try {
      const client = await getClient();
      await client.disconnect({
        topic: _activeSession.topic,
        reason: { code: 6000, message: "User disconnected" },
      });
    } catch {
      /* ignore */
    }
    _activeSession = null;
  }

  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(TOPIC_KEY);
    } catch {
      /* ignore */
    }
  }
}
