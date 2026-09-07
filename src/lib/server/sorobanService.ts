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

// ---- Read (simulate only) ----

export async function simulateContractCallServer(
  contractId: string,
  functionName: string,
  args: StellarSdk.xdr.ScVal[],
  signerPublicKey: string,
): Promise<{ resultValue?: string }> {
  const contract = new StellarSdk.Contract(contractId);
  const sourceAccount = await horizonServer.loadAccount(signerPublicKey);

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build();

  const simResponse = await sorobanServer.simulateTransaction(tx);
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
  const sourceAccount = await horizonServer.loadAccount(signerPublicKey);
  const feeStats = await horizonServer.fetchBaseFee();
  const fee = String(Math.floor(Number(feeStats) * 2));

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build();

  return { xdr: tx.toXDR() };
}

// ---- Submit ----

export async function submitContractInvocation(
  signedXdr: string,
  contractId: string,
  functionName: string,
  signerPublicKey: string,
  requestInfo: { ip?: string; userAgent?: string },
): Promise<{ hash: string; resultValue?: string }> {
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK.networkPassphrase,
  );

  const simResponse = await sorobanServer.simulateTransaction(signedTx);
  if (StellarSdk.rpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Simulation failed: ${simResponse.error}`);
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(signedTx, simResponse);
  const assembled = preparedTx as unknown as { built: { toXDR: () => string } };
  const finalXdr = assembled.built.toXDR();

  const finalSignedTx = StellarSdk.TransactionBuilder.fromXDR(
    finalXdr,
    STELLAR_NETWORK.networkPassphrase,
  );
  const response = await sorobanServer.sendTransaction(finalSignedTx);

  if (response.status === "ERROR") {
    throw new Error(`Contract submission failed: ${JSON.stringify(response)}`);
  }

  const MAX_POLL_ATTEMPTS = 30;
  let getTx = await sorobanServer.getTransaction(response.hash);
  let attempts = 0;
  while (
    getTx.status === StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND &&
    attempts < MAX_POLL_ATTEMPTS
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    getTx = await sorobanServer.getTransaction(response.hash);
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

  return { hash: response.hash, resultValue };
}

// ---- Events ----

/** Resolve the latest ledger sequence from the Soroban RPC server. */
export async function getLatestLedgerServer(): Promise<number> {
  const ledger = await sorobanServer.getLatestLedger();
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
    const response = await sorobanServer.getEvents({
      startLedger,
      filters: [{ type: "contract", contractIds: [contractId], topics: [["*"]] }],
      limit: 10,
    });

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
