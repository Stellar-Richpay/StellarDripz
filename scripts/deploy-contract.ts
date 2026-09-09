#!/usr/bin/env ts-node
/**
 * StellarDripz Multi-Contract Deployment Script
 *
 * Deploys all StellarDripz smart contracts to Stellar Testnet.
 *
 * Protocol 27 notes:
 *  - The WASM is uploaded first (deduplicated by stellar-core by wasm hash).
 *  - Each contract instance is created via `createContract` with:
 *      * preimage  = ContractIdPreimage::FromAddress(deployer_address, salt)
 *      * executable = ContractExecutable::Wasm(wasm_hash)
 *  - The contract ID is derived deterministically:
 *      contract_id = sha256( xdr(HashIdPreimageContractId {
 *          network_id: sha256(network_passphrase),
 *          contract_id_preimage: FromAddress { deployer, salt },
 *      }) )
 *
 * Usage:
 *   export DEPLOYER_SECRET_KEY="S..."
 *   npx ts-node --transpile-only scripts/deploy-contract.ts
 *
 * Requirements:
 *   - Funded Stellar Testnet account (~5 XLM recommended)
 *   - Compiled WASM: contracts/target/wasm32v1-none/release/stellardripz.wasm
 *   - Rust toolchain with wasm32v1-none target (Rust 1.84+)
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "./env-loader.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnv();

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
const SECRET_KEY = process.env.DEPLOYER_SECRET_KEY || "";

const WASM_PATH = path.join(
  __dirname,
  "..",
  "contracts",
  "target",
  "wasm32v1-none",
  "release",
  "stellardripz.wasm",
);

/** Deterministic 32-byte salt derived from the contract name. */
function saltFromName(name: string): Buffer {
  return StellarSdk.hash(Buffer.from(`stellardripz:${name}`, "utf-8"));
}

/** Build the account ScAddress XDR for a given public key. */
function accountScAddress(deployerPub: string): StellarSdk.xdr.ScAddress {
  return StellarSdk.xdr.ScAddress.scAddressTypeAccount(
    StellarSdk.xdr.AccountId.publicKeyTypeEd25519(
      StellarSdk.StrKey.decodeEd25519PublicKey(deployerPub),
    ),
  );
}

/** Derive the deterministic contract ID (StrKey C...) for a given deployer + salt. */
function deriveContractId(deployerPub: string, salt: Buffer): string {
  const networkId = StellarSdk.hash(Buffer.from(NETWORK_PASSPHRASE, "utf-8"));
  const idPreimage = StellarSdk.xdr.HashIdPreimage.envelopeTypeContractId(
    new StellarSdk.xdr.HashIdPreimageContractId({
      networkId,
      contractIdPreimage: StellarSdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new StellarSdk.xdr.ContractIdPreimageFromAddress({
          address: accountScAddress(deployerPub),
          salt,
        }),
      ),
    }),
  );
  const contractIdBytes = StellarSdk.hash(idPreimage.toXDR());
  return StellarSdk.StrKey.encodeContract(contractIdBytes);
}

async function waitForTx(
  server: StellarSdk.rpc.Server,
  hash: string,
  label: string,
): Promise<StellarSdk.rpc.Api.GetTransactionResponse> {
  for (let i = 0; i < 120; i++) {
    const tx = await server.getTransaction(hash);
    if (tx.status !== StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND) {
      return tx;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timeout waiting for ${label} — TX: ${hash}`);
}

async function main() {
  if (!SECRET_KEY) {
    console.error("❌ DEPLOYER_SECRET_KEY is required. Set it to a funded Testnet secret key.");
    process.exit(1);
  }
  // Fail fast on a malformed secret instead of letting Keypair.fromSecret
  // throw an obscure error mid-script, after network calls have already
  // started (or, worse, after an upload transaction was submitted).
  if (!StellarSdk.StrKey.isValidEd25519SecretSeed(SECRET_KEY)) {
    console.error(
      "❌ DEPLOYER_SECRET_KEY is not a valid Stellar secret seed (expected an S... key).",
    );
    process.exit(1);
  }
  if (!fs.existsSync(WASM_PATH)) {
    console.error(`❌ WASM not found at ${WASM_PATH}\n   Build with: npm run contracts:build`);
    process.exit(1);
  }
  // A 0-byte (or truncated) "wasm" would only fail later at simulate time
  // with a confusing RPC error — reject it before any network work.
  const wasmStat = fs.statSync(WASM_PATH);
  if (wasmStat.size === 0) {
    console.error(
      `❌ WASM at ${WASM_PATH} is empty (0 bytes). Rebuild with: npm run contracts:build`,
    );
    process.exit(1);
  }

  const rpc = new StellarSdk.rpc.Server(RPC_URL);
  const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);
  const keypair = StellarSdk.Keypair.fromSecret(SECRET_KEY);
  const deployerPub = keypair.publicKey();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║      StellarDripz Multi-Contract Deployer          ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`📡 RPC:   ${RPC_URL}`);
  console.log(`🔑 Key:   ${deployerPub}`);

  const account = await horizon.loadAccount(deployerPub);
  const xlmBalance =
    account.balances.find((b) => b.asset_type === "native")?.balance || "0";
  console.log(`💰 XLM:   ${xlmBalance}`);

  const wasmBuffer = fs.readFileSync(WASM_PATH);
  const wasmHash = StellarSdk.hash(wasmBuffer);
  const wasmHashHex = wasmHash.toString("hex");
  console.log(`📦 WASM:  ${(wasmBuffer.length / 1024).toFixed(2)} KB`);
  console.log(`🔐 Hash:  ${wasmHashHex}`);

  const feeStats = await horizon.fetchBaseFee();
  const fee = String(Math.max(1000, Math.floor(Number(feeStats) * 10)));

  // Step 1: Upload WASM (stellar-core dedups by hash — safe to repeat)
  console.log("\n─── Step 1: Upload WASM ───");
  const uploadOp = StellarSdk.Operation.invokeHostFunction({
    func: StellarSdk.xdr.HostFunction.hostFunctionTypeUploadContractWasm(wasmBuffer),
    auth: [],
  });

  let uploadTx = new StellarSdk.TransactionBuilder(
    await horizon.loadAccount(deployerPub),
    { fee, networkPassphrase: NETWORK_PASSPHRASE },
  )
    .addOperation(uploadOp)
    .setTimeout(30)
    .build();

  console.log("🔄 Simulating upload...");
  let uploadSim = await rpc.simulateTransaction(uploadTx);
  if (StellarSdk.rpc.Api.isSimulationError(uploadSim)) {
    // WASM already uploaded — proceed (create step references it by hash).
    console.log("   ⚠️  Upload simulation warning (may already exist) — continuing.");
  } else {
    try {
      const prepared = StellarSdk.rpc.assembleTransaction(uploadTx, uploadSim).build();
      prepared.sign(keypair);
      const resp = await rpc.sendTransaction(prepared);
      console.log(`   📝 TX: ${resp.hash}`);
      const result = await waitForTx(rpc, resp.hash, "WASM upload");
      if (result.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
        console.log("   ✅ WASM uploaded");
      } else {
        console.log("   ⚠️  Upload tx did not report success — wasm may already be present.");
      }
    } catch {
      // Deduplicated by stellar-core (same wasm hash) — non-fatal.
      console.log("   ⚠️  Upload skipped (wasm likely already on-chain) — continuing.");
    }
  }

  // Step 2: Deploy each contract instance with a deterministic salt
  console.log("\n─── Step 2: Deploy Contracts ───\n");

  const contracts = ["Counter", "DripToken", "DripPool", "Governance", "Badge"];
  const deployed: Record<string, string> = {};

  for (const name of contracts) {
    const salt = saltFromName(name);
    const cid = deriveContractId(deployerPub, salt);
    console.log(`🔧 Deploying ${name}...`);
    console.log(`   (expected ID: ${cid})`);

    const preimage = StellarSdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new StellarSdk.xdr.ContractIdPreimageFromAddress({
        address: accountScAddress(deployerPub),
        salt,
      }),
    );

    const createOp = StellarSdk.Operation.invokeHostFunction({
      func: StellarSdk.xdr.HostFunction.hostFunctionTypeCreateContract(
        new StellarSdk.xdr.CreateContractArgs({
          contractIdPreimage: preimage,
          executable: StellarSdk.xdr.ContractExecutable.contractExecutableWasm(wasmHash),
        }),
      ),
      auth: [],
    });

    try {
      const srcAccount = await horizon.loadAccount(deployerPub);
      const tx = new StellarSdk.TransactionBuilder(srcAccount, {
        fee,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(createOp)
        .setTimeout(30)
        .build();

      const sim = await rpc.simulateTransaction(tx);
      if (StellarSdk.rpc.Api.isSimulationError(sim)) {
        const errText = JSON.stringify(sim);
        if (/already exists|ContractAlreadyExists|contract_id.*exist/i.test(errText)) {
          console.log(`   ✅ ${name} already deployed — ${cid}`);
          deployed[name] = cid;
        } else {
          console.log(`   ⚠️  ${name}: Simulation error — ${sim.error}`);
        }
        continue;
      }

      const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build();
      prepared.sign(keypair);
      const resp = await rpc.sendTransaction(prepared);
      console.log(`   📝 TX: ${resp.hash}`);

      const result = await waitForTx(rpc, resp.hash, name);
      if (
        result.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS ||
        /already exists/i.test(JSON.stringify(result))
      ) {
        deployed[name] = cid;
        console.log(`   ✅ ${name}: ${cid}`);
      } else {
        console.log(`   ❌ ${name}: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      console.log(
        `   ❌ ${name}: ${err instanceof Error ? err.message : "Failed"}`,
      );
    }
  }

  // Summary
  console.log("\n" + "=".repeat(64));
  console.log("   DEPLOYMENT SUMMARY");
  console.log("=".repeat(64));
  for (const [name, cid] of Object.entries(deployed)) {
    console.log(`   ${name.padEnd(14)} ${cid}`);
    console.log(`   ${" ".repeat(14)} https://stellar.expert/explorer/testnet/contract/${cid}`);
  }
  console.log("=".repeat(64));

  // Print env vars for the CI/CD pipeline + Vercel project
  if (deployed.Counter) console.log(`\nNEXT_PUBLIC_CONTRACT_COUNTER=${deployed.Counter}`);
  if (deployed.DripToken) console.log(`NEXT_PUBLIC_CONTRACT_DRIP_TOKEN=${deployed.DripToken}`);
  if (deployed.DripPool) console.log(`NEXT_PUBLIC_CONTRACT_DRIP_POOL=${deployed.DripPool}`);
  if (deployed.Governance) console.log(`NEXT_PUBLIC_CONTRACT_GOVERNANCE=${deployed.Governance}`);
  if (deployed.Badge) console.log(`NEXT_PUBLIC_CONTRACT_BADGE=${deployed.Badge}`);
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
