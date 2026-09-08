/**
 * Tests for the contract-submission integrity guard in sorobanService.
 *
 * submitContractInvocation decodes the signed XDR and must refuse to
 * simulate/log/attribute a transaction whose source account does not match
 * the signer the client claimed — the same envelope-vs-claim check the
 * payment route applies. The mismatch path throws before any network call,
 * so it is unit-testable without an RPC server.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { submitContractInvocation } from "@/lib/server/sorobanService";

const VALID_A = "GCNIK6CGM3DXD3NJPZBG4Z76NGCU6YNID3TK7OSTKOJXF3ALBVJWESXK";
// Checksum-valid but distinct from A (the zero/burn address).
const VALID_B = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/** Build an unsigned transaction envelope whose source is `source`. */
function buildEnvelope(source: string): string {
  const account = new StellarSdk.Account(source, "123456");
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: VALID_B,
        asset: StellarSdk.Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(30)
    .build();
  return tx.toXDR();
}

describe("submitContractInvocation source guard", () => {
  it("rejects an envelope whose source differs from the claimed signer", async () => {
    const envelope = buildEnvelope(VALID_A);

    await expect(
      submitContractInvocation(envelope, "contract-id", "fn", VALID_B, {
        ip: "127.0.0.1",
      }),
    ).rejects.toThrow(/source does not match/i);
  });

  it("rejects a garbage XDR up front", async () => {
    await expect(
      submitContractInvocation("not-an-xdr", "contract-id", "fn", VALID_A, {}),
    ).rejects.toThrow();
  });
});
