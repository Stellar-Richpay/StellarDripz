/**
 * Soroban service layer — wraps Soroban RPC for contract interaction
 * with server-side analytics logging.
 *
 * Core transaction logic is shared with src/lib/stellar/soroban.ts;
 * this module adds database logging and session tracking.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "@/lib/stellar/network";
import type { TxRecord } from "./dbService";
import { saveTransaction, logAnalytics } from "./dbService";

const sorobanServer = new StellarSdk.rpc.Server(STELLAR_NETWORK.sorobanRpcUrl);
const horizonServer = new StellarSdk.Horizon.Server(STELLAR_NETWORK.horizonUrl);

/**
 * Bound an external-network promise with a hard timeout. Serverless functions
 * must not hang on a stalled Horizon/RPC node — a dead node should surface a
 * client-facing error in seconds, not burn the function's wall-clock budget.
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

// ---- Read (simulate only) ----

export async function simulateContractCallServer(
  contractId: string,
  functionName: string,
  args: StellarSdk.xdr.ScVal[],
  signerPublicKey: string,
): Promise<{ resultValue?: string }> {
  const contract = new StellarSdk.Contract(contractId);
  const sourceAccount = await withTimeout(
    horizonServer.loadAccount(signerPublicKey),
    "Horizon account fetch",
  );

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build();

  const simResponse = await withTimeout(
    sorobanServer.simulateTransaction(tx),
    "Soroban simulateTransaction",
  );
  if (StellarSdk.rpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Simulation failed: ${simResponse.error}`);
  }

  let resultValue: string | undefined;
  if (simResponse.result?.retval) {
    resultValue = StellarSdk.scValToNative(simResponse.result.retval)?.toString();
  }
  return { resultValue };
}

// ---- Write (build XDR for frontend signing) ----

export async function buildContractInvocation(
  contractId: string,
  functionName: string,
  args: StellarSdk.xdr.ScVal[],
  signerPublicKey: string,
): Promise<{ xdr: string }> {
  const contract = new StellarSdk.Contract(contractId);
  const sourceAccount = await withTimeout(
    horizonServer.loadAccount(signerPublicKey),
    "Horizon account fetch",
  );
  const feeStats = await withTimeout(horizonServer.fetchBaseFee(), "Horizon base fee");
  const fee = String(Math.floor(Number(feeStats) * 2));

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build();

  // Prepare the invocation (simulate → assemble) BEFORE the wallet signs it.
  // A Soroban signature covers the envelope's Soroban transaction data —
  // footprint, resource fees and auth entries — so re-assembling after the
  // wallet signed could only produce an envelope nobody signed (on-chain:
  // txBadAuth). Returning the prepared envelope means the wallet signs exactly
  // what gets submitted.
  const simResponse = await withTimeout(
    sorobanServer.simulateTransaction(tx),
    "Soroban simulateTransaction",
  );
  if (StellarSdk.rpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Simulation failed: ${simResponse.error}`);
  }

  const prepared = StellarSdk.rpc.assembleTransaction(tx, simResponse).build();
  return { xdr: prepared.toXDR() };
}

// ---- Submit ----

export async function submitContractInvocation(
  signedXdr: string,
  contractId: string,
  functionName: string,
  signerPublicKey: string,
  requestInfo: { ip?: string; userAgent?: string },
): Promise<{ hash: string; resultValue?: string; status: "success" | "pending" }> {
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK.networkPassphrase,
  );

  // The envelope must originate from the account the request claims to be
  // signing as — mirror of the payment route's verifyPaymentTransaction().
  // Without this, anyone could POST a signed XDR for any contract call and
  // have it logged/attributed to an arbitrary signerAddress, and a
  // mismatch would otherwise only surface as an opaque RPC error.
  const innerTx =
    signedTx instanceof StellarSdk.FeeBumpTransaction ? signedTx.innerTransaction : signedTx;
  if (innerTx.source !== signerPublicKey) {
    throw new Error("Signed transaction source does not match the claimed signer address");
  }

  const simResponse = await withTimeout(
    sorobanServer.simulateTransaction(signedTx),
    "Soroban simulateTransaction",
  );
  if (StellarSdk.rpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Simulation failed: ${simResponse.error}`);
  }

  // The submitted envelope must already carry Soroban transaction data (the
  // build route prepares it, and a real wallet signs the prepared envelope).
  // Re-assembling here — which the previous implementation did — rebuilt the
  // envelope and silently dropped the wallet's signature, so every contract
  // write failed on-chain with txBadAuth. Validate instead of rewriting.
  const isPrepared = innerTx.toEnvelope().v1().tx().ext().switch() === 1; // 1 = SOROBAN_TX_DATA_EXT
  if (!isPrepared) {
    throw new Error(
      "Transaction is not prepared for submission: build it through /api/contract/invoke before signing",
    );
  }

  const response = await withTimeout(
    sorobanServer.sendTransaction(signedTx),
    "Soroban sendTransaction",
  );

  if (response.status === "ERROR") {
    throw new Error(`Contract submission failed: ${JSON.stringify(response)}`);
  }

  const MAX_POLL_ATTEMPTS = 30;
  let getTx = await withTimeout(
    sorobanServer.getTransaction(response.hash),
    "Soroban getTransaction",
  );
  let attempts = 0;
  while (
    getTx.status === StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND &&
    attempts < MAX_POLL_ATTEMPTS
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    getTx = await withTimeout(
      sorobanServer.getTransaction(response.hash),
      "Soroban getTransaction",
    );
    attempts++;
  }

  if (getTx.status === StellarSdk.rpc.Api.GetTransactionStatus.FAILED) {
    // On-chain failure — record it as an error so the UI can surface the
    // actual outcome instead of the previous bug where FAILED invocations
    // were logged (and shown) as successes.
    const failedTx: TxRecord = {
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "contract",
      status: "error",
      hash: response.hash,
      amount: "0",
      senderAddress: signerPublicKey,
      destinationAddress: contractId,
      functionName,
      contractId,
      errorMessage: `Contract invocation failed on-chain (hash ${response.hash})`,
      timestamp: Date.now(),
      ip: requestInfo.ip,
      userAgent: requestInfo.userAgent,
    };
    await saveTransaction(failedTx);
    throw new Error(
      `Contract invocation failed on-chain: ${JSON.stringify(getTx.resultXdr ? { resultXdr: getTx.resultXdr } : {})}`,
    );
  }

  let resultValue: string | undefined;
  if (getTx.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS && getTx.returnValue) {
    resultValue = StellarSdk.scValToNative(getTx.returnValue)?.toString();
  }

  // Server-side logging — only reached for SUCCESS (or the rare still-pending
  // case after the poll window, which we surface as-is rather than claiming
  // success).
  const txStatus: TxRecord["status"] =
    getTx.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS ? "success" : "pending";
  const txRecord: TxRecord = {
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "contract",
    status: txStatus,
    hash: response.hash,
    amount: "0",
    senderAddress: signerPublicKey,
    destinationAddress: contractId,
    functionName,
    contractId,
    timestamp: Date.now(),
    ip: requestInfo.ip,
    userAgent: requestInfo.userAgent,
  };
  await saveTransaction(txRecord);
  await logAnalytics({
    eventType: "contract_invoke",
    address: signerPublicKey,
    data: { contractId, functionName, status: txStatus },
  });

  // `status` tells the caller whether the confirmation poll reached a
  // terminal SUCCESS, or whether the transaction was submitted but the
  // confirmation window expired (still pending on-chain). The caller must
  // not present an unconfirmed submission as a confirmed success.
  return {
    hash: response.hash,
    resultValue,
    status: txStatus === "success" ? "success" : "pending",
  };
}

// ---- Events ----

/** Resolve the latest ledger sequence from the Soroban RPC server. */
export async function getLatestLedgerServer(): Promise<number> {
  const ledger = await withTimeout(sorobanServer.getLatestLedger(), "Soroban getLatestLedger");
  return Number(ledger.sequence);
}

/**
 * If startLedger is 0 (first connection), start from a recent window instead of
 * scanning the entire chain history — fast on cold serverless starts.
 */
async function resolveStartLedger(startLedger: number): Promise<number> {
  if (startLedger > 0) return startLedger;
  try {
    const latest = await getLatestLedgerServer();
    return Math.max(0, latest - 100);
  } catch {
    return 0;
  }
}

export async function getContractEventsServer(
  contractId: string,
  startLedger: number,
): Promise<{ events: Array<{ topic: string; value: string }>; latestLedger: number }> {
  startLedger = await resolveStartLedger(startLedger);
  try {
    const response = await withTimeout(
      sorobanServer.getEvents({
        startLedger,
        filters: [{ type: "contract", contractIds: [contractId], topics: [["*"]] }],
        limit: 10,
      }),
      "Soroban getEvents",
    );

    const events: Array<{ topic: string; value: string }> = [];
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
          events.push({ topic, value });
        } catch {
          /* skip */
        }
        if (event.ledger > latestLedger) latestLedger = event.ledger;
      }
    }
    return { events, latestLedger };
  } catch {
    return { events: [], latestLedger: startLedger };
  }
}
