/**
 * TypeScript types for StellarDripz — shared across hooks, components, and services.
 * All exported types use strict mode with no `any` in the consumer-facing API.
 */
// --- Wallet Types ---

export type NetworkType = "TESTNET" | "MAINNET" | "UNKNOWN";

export interface SupportedWallet {
  id: string;
  name: string;
  iconUrl: string;
  installed: boolean;
}

export interface WalletState {
  connected: boolean;
  publicKey: string | null;
  network: NetworkType;
  walletId: string | null;
  walletName: string | null;
  isAnyWalletInstalled: boolean;
  availableWallets: SupportedWallet[];
}

// --- Asset Types ---

export interface StellarAsset {
  code: string;
  issuer: string;
  type: "native" | "credit_alphanum4" | "credit_alphanum12";
}

export interface AssetBalance {
  asset: StellarAsset;
  balance: string;
  formatted: string;
}

// --- Balance Types ---

export interface BalanceInfo {
  xlm: string;
  raw: string;
  lastFetched: Date | null;
  assets: AssetBalance[];
}

// --- Transaction Types ---

export type TxStatus = "idle" | "pending" | "success" | "error";

export type TxType = "faucet" | "send" | "contract";

export interface TransactionRecord {
  id: string;
  type: TxType;
  status: TxStatus;
  hash: string | null;
  amount: string;
  destination: string;
  timestamp: Date;
  errorMessage?: string;
  explorerUrl?: string;
  assetCode?: string;
  contractId?: string;
  functionName?: string;
  memo?: string;
  ledgerSequence?: number;
  /** Network fee in stroops charged by the transaction (send payments). */
  feeStroops?: number;
}

// --- Contract Event Types ---

export interface ContractEvent {
  id: string;
  contractId: string;
  topic: string;
  value: string;
  ledgerSequence: number;
  timestamp: Date;
  txHash: string;
}

// --- Rate Limit Types ---

export interface CooldownState {
  address: string;
  remainingMs: number;
  canRequest: boolean;
}

// --- Analytics Types ---

export interface FaucetAnalytics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  uniqueAddresses: number;
  rateLimitedRequests: number;
}

export interface NetworkStatus {
  horizon: { status: "ok" | "error"; latency?: number; error?: string };
  sorobanRpc: { status: "ok" | "error"; latency?: number; error?: string };
  friendbot: { status: "ok" | "error"; latency?: number; error?: string };
}

// --- App State ---

export interface AppState {
  wallet: WalletState;
  balance: BalanceInfo & { loading: boolean; error: string | null };
  transactions: TransactionRecord[];
  txInProgress: TxStatus;
  contractEvents: ContractEvent[];
  cooldown: CooldownState | null;
}
