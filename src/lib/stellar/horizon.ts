/**
 * Horizon helper — balance fetching, faucet, and payment transaction logic.
 *
 * For server-side usage, prefer src/lib/server/horizonService.ts which adds
 * database logging, analytics, and session tracking.
 *
 * This module provides the client-side (direct browser→Horizon) operations
 * used by the hybrid reads/writes architecture. It relies on walletKit.signTx
 * for signing, which requires a connected browser wallet.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "./network";
import { formatAssetAmount, formatXlmAmount } from "./format";
import { signTx } from "../wallets/walletKit";
import type { BalanceInfo, AssetBalance, StellarAsset } from "@/types/stellar";

const server = new StellarSdk.Horizon.Server(STELLAR_NETWORK.horizonUrl);

// ---- Balance ----

function parseBalance(b: {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}): AssetBalance | null {
  const raw = b.balance;

  if (b.asset_type === "native") {
    return {
      asset: { code: "XLM", issuer: "", type: "native" },
      balance: raw,
      formatted: formatXlmAmount(raw),
    };
  }

  if (b.asset_type === "liquidity_pool_shares") return null;

  const asset: StellarAsset = {
    code: b.asset_code || "???",
    issuer: b.asset_issuer || "",
    type: b.asset_type as "credit_alphanum4" | "credit_alphanum12",
  };

  return {
    asset,
    balance: raw,
    formatted: formatAssetAmount(raw, asset.type),
  };
}

export async function fetchBalance(publicKey: string): Promise<BalanceInfo> {
  try {
    const account = await server.loadAccount(publicKey);
    const assets: AssetBalance[] = account.balances
      .map(parseBalance)
      .filter((a): a is AssetBalance => a !== null);

    const xlmAsset = assets.find((a) => a.asset.type === "native");
    const xlm = xlmAsset?.formatted || "0.0000000";
    const raw = xlmAsset?.balance || "0";

    return { xlm, raw, assets, lastFetched: new Date() };
  } catch (err: unknown) {
    if (err instanceof StellarSdk.NotFoundError) {
      return { xlm: "0.0000000", raw: "0", assets: [], lastFetched: new Date() };
    }
    throw err;
  }
}

// ---- Faucet ----

export async function requestFaucetFunds(
  publicKey: string,
): Promise<{ hash: string; newBalance: string }> {
  const url = `${STELLAR_NETWORK.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail || body?.title || `HTTP ${res.status}: ${res.statusText}`;
    if (typeof detail === "string") {
      if (detail.toLowerCase().includes("already funded"))
        throw new Error("Account already funded — no funds needed!");
      if (detail.toLowerCase().includes("rate limit"))
        throw new Error("Rate limited — try again in a few seconds.");
    }
    throw new Error(`Friendbot error: ${detail}`);
  }

  const data = await res.json();
  const hash = data?.transaction_hash || data?.hash || data?.id || null;
  const balance = await fetchBalance(publicKey);
  return { hash: hash || `faucet-${Date.now()}`, newBalance: balance.xlm };
}

// ---- Payments ----

function toStellarAsset(asset: StellarAsset): StellarSdk.Asset {
  if (asset.type === "native") return StellarSdk.Asset.native();
  return new StellarSdk.Asset(asset.code, asset.issuer);
}

export async function sendPayment(
  senderPublicKey: string,
  destination: string,
  amount: string,
  asset?: StellarAsset,
): Promise<{ hash: string }> {
  if (STELLAR_NETWORK.networkPassphrase !== StellarSdk.Networks.TESTNET) {
    throw new Error("Network mismatch — expected Testnet.");
  }

  try {
    StellarSdk.StrKey.decodeEd25519PublicKey(destination);
  } catch {
    throw new Error("Invalid destination Stellar address.");
  }

  const sourceAccount = await server.loadAccount(senderPublicKey);
  const feeStats = await server.fetchBaseFee();
  const fee = String(Math.floor(Number(feeStats) * 2));
  const stellarAsset = asset ? toStellarAsset(asset) : StellarSdk.Asset.native();

  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  })
    .addOperation(StellarSdk.Operation.payment({ destination, asset: stellarAsset, amount }))
    .setTimeout(30)
    .build();

  const xdr = transaction.toXDR();
  const signedXdr = await signTx(xdr, senderPublicKey);
  const signedTransaction = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK.networkPassphrase,
  );
  const response = await server.submitTransaction(signedTransaction);
  return { hash: response.hash };
}

// ---- Explorer ----

export function getExplorerUrl(hash: string): string {
  return `${STELLAR_NETWORK.stellarExpertUrl}/tx/${hash}`;
}

export { server };
