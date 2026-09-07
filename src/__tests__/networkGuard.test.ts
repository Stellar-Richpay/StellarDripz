/**
 * Tests for the wallet/app network mismatch helper.
 */
import { getNetworkState } from "@/lib/stellar/networkGuard";
import { STELLAR_NETWORK } from "@/lib/stellar/network";

const APP_IS_MAINNET = STELLAR_NETWORK.network === "MAINNET";
// The wallet-side value that matches the app's configured network.
const MATCHING_WALLET = APP_IS_MAINNET ? "MAINNET" : "TESTNET";
const OPPOSITE_WALLET = APP_IS_MAINNET ? "TESTNET" : "MAINNET";

describe("getNetworkState", () => {
  it("treats a matching wallet network as no mismatch", () => {
    expect(getNetworkState(MATCHING_WALLET).mismatch).toBe(false);
    expect(getNetworkState(MATCHING_WALLET).matches).toBe(true);
  });

  it("flags a wallet on the opposite network as a mismatch", () => {
    const state = getNetworkState(OPPOSITE_WALLET);
    expect(state.mismatch).toBe(true);
    expect(state.matches).toBe(false);
  });

  it("never hard-blocks an unknown wallet network", () => {
    expect(getNetworkState("UNKNOWN").mismatch).toBe(false);
    expect(getNetworkState("UNKNOWN").matches).toBe(true);
    expect(getNetworkState(undefined).matches).toBe(true);
    expect(getNetworkState(null).matches).toBe(true);
  });

  it("labels networks in plain language", () => {
    expect(getNetworkState("MAINNET").walletLabel).toBe("Mainnet");
    expect(getNetworkState("TESTNET").walletLabel).toBe("Testnet");
    expect(getNetworkState("FOO").walletLabel).toBe("FOO");
    expect(getNetworkState(undefined).walletLabel).toBeNull();
  });

  it("reports the app network the wallet must match", () => {
    const state = getNetworkState(MATCHING_WALLET);
    expect(state.appLabel).toBe(APP_IS_MAINNET ? "Mainnet" : "Testnet");
  });
});
