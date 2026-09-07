/**
 * Direct Stellar client — browser-side reads that bypass the API proxy.
 *
 * Reads (balance, contract simulation, events) talk directly to Stellar Horizon
 * and Soroban RPC for lower latency. Writes (faucet, payments, contract invocations)
 * still go through the API proxy for rate limiting, logging, and cooldown enforcement.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "@/lib/stellar/network";

// ---- Lazy-initialized singletons ---- //

let _horizonServer: StellarSdk.Horizon.Server | null = null;
let _sorobanServer: StellarSdk.rpc.Server | null = null;

function horizon(): StellarSdk.Horizon.Server {
  if (!_horizonServer) {
    _horizonServer = new StellarSdk.Horizon.Server(STELLAR_NETWORK.horizonUrl);
  }
  return _horizonServer;
}

function soroban(): StellarSdk.rpc.Server {
  if (!_sorobanServer) {
    _sorobanServer = new StellarSdk.rpc.Server(STELLAR_NETWORK.sorobanRpcUrl);
  }
  return _sorobanServer;
}

// ---- Types ---- //

export interface DirectBalanceResult {
  xlm: string;
  raw: string;
  assets: Array<{ code: string; issuer: string; balance: string; formatted: string }>;
}

export interface DirectContractEvent {
  topic: string;
  value: string;
  contractId: string;
}

export interface DirectSimulateResult {
  resultValue?: string;
}

// ---- Horizon Reads ---- //

/**
 * Fetch account balance directly from Horizon (no API proxy).
 */
export async function directFetchBalance(address: string): Promise<DirectBalanceResult> {
  const account = await horizon().loadAccount(address);

  const assets: DirectBalanceResult["assets"] = [];
  let xlm = "0.0000000";
  let raw = "0";

  for (const b of account.balances) {
    if (b.asset_type === "native") {
      const num = parseFloat(b.balance);
      xlm = num.toLocaleString("en-US", {
        minimumFractionDigits: 7,
        maximumFractionDigits: 7,
      });
      raw = b.balance;
    } else if (b.asset_type !== "liquidity_pool_shares") {
      const decimals = b.asset_type === "credit_alphanum4" ? 7 : 12;
      assets.push({
        code: b.asset_code || "???",
        issuer: b.asset_issuer || "",
        balance: b.balance,
        formatted: parseFloat(b.balance).toLocaleString("en-US", {
          minimumFractionDigits: Math.min(decimals, 7),
          maximumFractionDigits: Math.min(decimals, 7),
        }),
      });
    }
  }

  return { xlm, raw, assets };
}

// NOTE: There is intentionally NO direct faucet helper here. Faucet funding
// must go through the proxied /api/faucet/fund route so the server-side
// per-address rate limiter and analytics apply; a browser-direct Friendbot
// call would bypass both. See QRFundModal for the read-only faucet URL that
// is safe to share off-device.

// ---- Soroban Reads ---- //

/**
 * Simulate a contract call directly against Soroban RPC (no API proxy).
 * This is a read-only operation — no transaction is submitted.
 */
export async function directSimulateContract(
  contractId: string,
  functionName: string,
  args: StellarSdk.xdr.ScVal[],
  signerPublicKey: string,
): Promise<DirectSimulateResult> {
  const sourceAccount = await horizon().loadAccount(signerPublicKey);
  const contract = new StellarSdk.Contract(contractId);
  const op = contract.call(functionName, ...args);

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResponse = await soroban().simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Contract simulation failed: ${simResponse.error}`);
  }

  let resultValue: string | undefined;
  if (simResponse.result?.retval) {
    resultValue = StellarSdk.scValToNative(simResponse.result.retval)?.toString();
  }

  return { resultValue };
}

/**
 * Fetch contract events directly from Soroban RPC (no API proxy).
 */
export async function directFetchContractEvents(
  contractId: string,
  startLedger: number,
  limit = 10,
): Promise<{ events: DirectContractEvent[]; latestLedger: number }> {
  try {
    const response = await soroban().getEvents({
      startLedger,
      filters: [{ type: "contract", contractIds: [contractId], topics: [["*"]] }],
      limit,
    });

    const events: DirectContractEvent[] = [];
    let latestLedger = startLedger;

    if (response.events) {
      for (const event of response.events) {
        try {
          const topic = event.topic.map((t: unknown) => String(t)).join(":") || "unknown";
          const rawValue = (event as unknown as { value: string }).value;
          const value = rawValue
            ? StellarSdk.scValToNative(
                StellarSdk.xdr.ScVal.fromXDR(rawValue, "base64"),
              )?.toString() || ""
            : "";
          events.push({ topic, value, contractId });
        } catch {
          /* skip malformed events */
        }
        if (event.ledger > latestLedger) latestLedger = event.ledger;
      }
    }

    return { events, latestLedger };
  } catch {
    return { events: [], latestLedger: startLedger };
  }
}

/**
 * Get the latest ledger sequence directly from Soroban RPC.
 */
export async function directGetLatestLedger(): Promise<number> {
  try {
    const health = await soroban().getLatestLedger();
    return health.sequence;
  } catch {
    return 0;
  }
}

// ---- Re-export config for convenience ---- //

export { STELLAR_NETWORK };
