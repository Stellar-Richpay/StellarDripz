/**
 * Unit tests for config and transaction service pure functions
 */
import { STELLAR_NETWORK } from "@/lib/stellar/network";
import { getExplorerUrl } from "@/lib/stellar/explorer";

describe("STELLAR_NETWORK", () => {
  it("has required Stellar testnet configuration", () => {
    expect(STELLAR_NETWORK.network).toBe("TESTNET");
    expect(STELLAR_NETWORK.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(STELLAR_NETWORK.friendbotUrl).toBe("https://friendbot.stellar.org");
    expect(STELLAR_NETWORK.networkPassphrase).toBe("Test SDF Network ; September 2015");
    expect(STELLAR_NETWORK.stellarExpertUrl).toBe("https://stellar.expert/explorer/testnet");
  });
});

describe("getExplorerUrl", () => {
  it("returns the correct Stellar Expert URL for a transaction hash", () => {
    const hash = "abc123def456";
    const url = getExplorerUrl(hash);

    expect(url).toBe("https://stellar.expert/explorer/testnet/tx/abc123def456");
  });
});
