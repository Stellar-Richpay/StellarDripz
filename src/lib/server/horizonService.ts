/**
 * Horizon service layer — wraps Stellar Horizon API for balance, payments, faucet.
 * All requests are validated server-side before hitting Horizon.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "@/lib/stellar/network";
import { formatAssetAmount, formatXlmAmount } from "@/lib/stellar/format";
import type { TxRecord } from "./dbService";
import { saveTransaction, logAnalytics } from "./dbService";
import { HttpError } from "./http";

const horizonServer = new StellarSdk.Horizon.Server(STELLAR_NETWORK.horizonUrl);

/**
 * Bound an SDK promise (loadAccount, submitTransaction, …) with a hard
 * timeout. The Horizon SDK's HTTP calls carry no timeout of their own, so a
 * stalled node would otherwise hang a serverless invocation until the
 * platform kills it — leaving the user with a spinner and no error.
 */
async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after 10s`)), 10_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetch with an explicit timeout and a single retry for transient failures.
 * Prevents a hung upstream (Friendbot/Horizon) from tying up a serverless
 * invocation indefinitely.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      attempt++;
      // Retry once on network errors and timeouts (AbortError), not on HTTP
      // status codes — those are handled by the caller.
      if (attempt >= 2 || !(err instanceof Error)) throw err;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
}

// ---- Balance ----

export interface BalanceResponse {
  xlm: string;
  raw: string;
  assets: Array<{
    code: string;
    issuer: string;
    type: string;
    balance: string;
    formatted: string;
  }>;
  lastFetched: string;
}

export async function fetchBalanceServer(publicKey: string): Promise<BalanceResponse> {
  // NOTE: deliberately no logAnalytics here. Balance reads are polled by the
  // frontend (and by the balance route on every page load), so logging each
  // one polluted the analytics table with tens of thousands of low-value rows
  // and made every balance fetch a database write.

  try {
    const account = await withTimeout(horizonServer.loadAccount(publicKey), "Horizon loadAccount");
    const assets = account.balances
      .filter((b) => b.asset_type !== "liquidity_pool_shares")
      .map((b) => {
        const raw = b.balance;
        if (b.asset_type === "native") {
          return {
            code: "XLM",
            issuer: "",
            type: "native",
            balance: raw,
            formatted: formatXlmAmount(raw),
          };
        }
        return {
          code: b.asset_code || "???",
          issuer: b.asset_issuer || "",
          type: b.asset_type,
          balance: raw,
          formatted: formatAssetAmount(raw, b.asset_type),
        };
      });

    const xlmAsset = assets.find((a) => a.type === "native");
    return {
      xlm: xlmAsset?.formatted || "0.0000000",
      raw: xlmAsset?.balance || "0",
      assets,
      lastFetched: new Date().toISOString(),
    };
  } catch (err: unknown) {
    if (err instanceof StellarSdk.NotFoundError) {
      return { xlm: "0.0000000", raw: "0", assets: [], lastFetched: new Date().toISOString() };
    }
    throw err;
  }
}

// ---- Faucet ----

/**
 * Faucet funding only exists on test networks — Friendbot is not deployed
 * for mainnet and free XLM would be meaningless (and dangerous) there.
 * Throws when the app is configured for mainnet.
 */
export function assertFaucetAllowed(): void {
  if (!STELLAR_NETWORK.networkPassphrase.includes("Test")) {
    // Configuration/usage error on the caller's side, not a server fault.
    throw new HttpError(400, "Faucet is only available on test networks");
  }
}

export async function requestFaucetFundsServer(
  publicKey: string,
  requestInfo: { ip?: string; userAgent?: string },
): Promise<{ hash: string; newBalance: string }> {
  assertFaucetAllowed();

  const url = `${STELLAR_NETWORK.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`;
  const res = await fetchWithTimeout(url, {}, 15_000);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail || body?.title || `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : "Friendbot error");
  }

  const data = await res.json();
  const hash = data?.hash || data?.transaction_hash || data?.id || `faucet-${Date.now()}`;
  const balance = await fetchBalanceServer(publicKey);

  // Log to database
  const txRecord: TxRecord = {
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "faucet",
    status: "success",
    hash,
    amount: "10000",
    assetCode: "XLM",
    senderAddress: "friendbot",
    destinationAddress: publicKey,
    timestamp: Date.now(),
    ip: requestInfo.ip,
    userAgent: requestInfo.userAgent,
  };
  await saveTransaction(txRecord);
  await logAnalytics({
    eventType: "faucet_request",
    address: publicKey,
    data: { hash, amount: "10000" },
  });

  return { hash, newBalance: balance.xlm };
}

// ---- Payment ----

export async function sendPaymentServer(
  senderPublicKey: string,
  signedXdr: string,
  destination: string,
  amount: string,
  assetCode: string,
  requestInfo: { ip?: string; userAgent?: string },
  assetIssuer?: string,
  memo?: string,
): Promise<{ hash: string }> {
  // No hardcoded network gate here: the passphrase check happens implicitly
  // below when the signed XDR is decoded with STELLAR_NETWORK.networkPassphrase
  // (a testnet-signed envelope cannot decode on a mainnet deployment and vice
  // versa). A previous hardcoded "expected Testnet" gate silently disabled
  // payments entirely on mainnet-configured deployments.

  // Validate destination. These are caller mistakes — classify them as 400
  // so production callers see the reason instead of a generic 500.
  try {
    StellarSdk.StrKey.decodeEd25519PublicKey(destination);
  } catch {
    throw new HttpError(400, "Invalid destination address.");
  }

  // Validate memo up front so a too-long memo is rejected before submission
  // (Horizon rejects it after the fact with an opaque error).
  const memoError = validateMemo(memo);
  if (memoError) throw new HttpError(400, memoError);

  // Submit the signed transaction
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK.networkPassphrase,
  );

  // Verify the signed envelope matches the payment the client claimed it
  // was building. Without this, anyone could POST any pre-signed XDR and
  // have it attributed to arbitrary sender/destination/amount records (and
  // our analytics/logging would record forged data).
  const innerTx =
    signedTx instanceof StellarSdk.FeeBumpTransaction ? signedTx.innerTransaction : signedTx;
  verifyPaymentTransaction(
    innerTx,
    senderPublicKey,
    destination,
    amount,
    assetCode,
    assetIssuer,
    memo,
  );

  const response = await withTimeout(
    horizonServer.submitTransaction(signedTx),
    "Horizon submitTransaction",
  );

  // Log
  const txRecord: TxRecord = {
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "send",
    status: "success",
    hash: response.hash,
    amount,
    assetCode,
    memo,
    senderAddress: senderPublicKey,
    destinationAddress: destination,
    timestamp: Date.now(),
    ip: requestInfo.ip,
    userAgent: requestInfo.userAgent,
  };
  await saveTransaction(txRecord);
  await logAnalytics({
    eventType: "payment_send",
    address: senderPublicKey,
    data: { hash: response.hash, amount, destination },
  });

  return { hash: response.hash };
}

/**
 * Verify a signed transaction envelope matches the claimed payment.
 * Throws on any mismatch — the caller turns this into a 400/500 response.
 */
function verifyPaymentTransaction(
  tx: StellarSdk.Transaction,
  senderPublicKey: string,
  destination: string,
  amount: string,
  assetCode: string,
  assetIssuer?: string,
  memo?: string,
): void {
  // TransactionBuilder.fromXDR already validated the network passphrase by
  // decoding with ours. Check the source account matches the claimed sender.
  const expectedAssetCode = assetCode || "XLM";

  // Memo is part of what makes a signed payment distinguishable; verify it
  // matches so a submitted XDR can't silently carry different memo text than
  // the user saw and approved. Only text memos are produced by the build
  // path, so compare the string value directly.
  const txMemoValue =
    tx.memo instanceof StellarSdk.Memo && tx.memo.value !== null && tx.memo.value !== undefined
      ? String(tx.memo.value)
      : "";
  if ((memo || "") !== txMemoValue) {
    throw new HttpError(400, "Transaction memo does not match requested memo");
  }

  if (tx.source !== senderPublicKey) {
    throw new HttpError(400, "Transaction source does not match sender address");
  }

  let paymentOps = 0;
  for (const op of tx.operations) {
    if (op.type !== "payment") continue;
    paymentOps++;

    if (op.destination !== destination) {
      throw new HttpError(400, "Transaction destination does not match requested recipient");
    }
    if (op.amount !== amount) {
      throw new HttpError(400, "Transaction amount does not match requested amount");
    }
    const actualCode = op.asset.isNative() ? "XLM" : op.asset.code;
    if (actualCode !== expectedAssetCode) {
      throw new HttpError(400, "Transaction asset does not match requested asset");
    }
    // For non-native assets the issuer must match too — two assets can share
    // a code but have different issuers.
    if (!op.asset.isNative() && assetIssuer && op.asset.issuer !== assetIssuer) {
      throw new HttpError(400, "Transaction asset issuer does not match requested issuer");
    }
  }

  if (paymentOps === 0) {
    throw new HttpError(400, "Transaction contains no payment operation");
  }
}

// ---- Build Transaction (returns XDR for frontend to sign) ----

/**
 * Validate a Stellar amount string: positive, decimal, and within the
 * asset's precision (7 decimals for XLM/alphanum4, 12 for alphanum12).
 * Returns an error message or null.
 */
export function validateAmount(amount: string, assetCode?: string): string | null {
  const value = amount.trim();
  if (!value) return "Amount is required";
  if (!/^\d+(\.\d+)?$/.test(value)) return "Amount must be a positive number";

  const maxDecimals = assetCode && assetCode !== "XLM" ? 12 : 7;
  const [, fraction = ""] = value.split(".");
  if (fraction.length > maxDecimals) {
    return `Amount has too many decimal places (max ${maxDecimals})`;
  }

  const num = parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) return "Amount must be greater than zero";
  return null;
}

/**
 * Validate an asset code: 1–12 alphanumeric characters (upper case).
 * Returns an error message or null.
 */
export function validateAssetCode(assetCode: string): string | null {
  if (!/^[A-Z0-9]{1,12}$/.test(assetCode)) {
    return "Invalid asset code (1-12 upper-case alphanumeric characters)";
  }
  return null;
}

/**
 * Validate a text memo: optional, and at most 28 bytes when present (the
 * Stellar protocol limit for text memos). Returns an error message or null.
 */
export function validateMemo(memo?: string): string | null {
  if (!memo) return null;
  if (new TextEncoder().encode(memo).length > 28) {
    return "Memo must be 28 characters or fewer";
  }
  return null;
}

export async function buildPaymentTransaction(
  senderPublicKey: string,
  destination: string,
  amount: string,
  assetCode?: string,
  assetIssuer?: string,
  memo?: string,
): Promise<{ xdr: string; feeStroops: number }> {
  try {
    StellarSdk.StrKey.decodeEd25519PublicKey(destination);
  } catch {
    throw new Error("Invalid destination address.");
  }

  const amountError = validateAmount(amount, assetCode);
  if (amountError) throw new Error(amountError);
  if (assetCode && assetCode !== "XLM") {
    const codeError = validateAssetCode(assetCode);
    if (codeError) throw new Error(codeError);
  }
  const memoError = validateMemo(memo);
  if (memoError) throw new Error(memoError);

  // XLM is native — an issuer is never valid for it. Rejecting here (and not
  // just in the route) protects every future caller of this builder.
  if (assetIssuer && (!assetCode || assetCode === "XLM")) {
    throw new Error("Asset issuer is only valid for non-native assets");
  }

  // Non-native assets require an issuer — previously the sender was used as
  // the issuer, which silently built a payment for a different (usually
  // nonexistent) asset than the user held.
  if (assetCode && assetCode !== "XLM" && !assetIssuer) {
    throw new Error("Asset issuer is required for non-native assets");
  }
  if (assetIssuer) {
    try {
      StellarSdk.StrKey.decodeEd25519PublicKey(assetIssuer);
    } catch {
      throw new Error("Invalid asset issuer address.");
    }
  }

  const sourceAccount = await withTimeout(
    horizonServer.loadAccount(senderPublicKey),
    "Horizon loadAccount",
  );
  const feeStats = await withTimeout(horizonServer.fetchBaseFee(), "Horizon fetchBaseFee");
  const fee = String(Math.floor(Number(feeStats) * 2));

  const asset =
    !assetCode || assetCode === "XLM"
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(assetCode, assetIssuer!);

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  })
    .addOperation(StellarSdk.Operation.payment({ destination, asset, amount }))
    .setTimeout(30);

  if (memo) {
    tx.addMemo(StellarSdk.Memo.text(memo));
  }

  // Return the fee in stroops alongside the XDR so the UI can preview the
  // cost before the user approves the signing prompt.
  return { xdr: tx.build().toXDR(), feeStroops: Number(fee) };
}
