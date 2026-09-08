/**
 * Tests for the explorer URL builders.
 */
import {
  getExplorerUrl,
  getAccountExplorerUrl,
  getContractExplorerUrl,
} from "@/lib/stellar/explorer";

// network.ts resolves STELLAR_NETWORK from the (test) env defaults — the
// testnet explorer URLs. The builders must compose URLs from those values.
describe("explorer URL builders", () => {
  it("links a transaction hash to the explorer tx page", () => {
    const hash = "abcdef0123456789";
    const url = getExplorerUrl(hash);
    expect(url).toContain("/tx/");
    expect(url.endsWith(hash)).toBe(true);
    expect(url.startsWith("https://")).toBe(true);
  });

  it("links an account to the explorer account page", () => {
    const addr = "GC2MCTJBOATQKMURSX443SX25PGV34SK7U56UJ3Y7HHXQ2JK57OR23SX";
    const url = getAccountExplorerUrl(addr);
    expect(url).toContain("/account/");
    expect(url.endsWith(addr)).toBe(true);
  });

  it("links a contract id to the contract explorer page", () => {
    const cid = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const url = getContractExplorerUrl(cid);
    expect(url).toContain("/contract/");
    expect(url.endsWith(cid)).toBe(true);
  });

  it("uses the same network base for tx and account links", () => {
    // Both link types must point at the same explorer host for the active
    // network — a mismatch would send users to the wrong network's explorer.
    const txBase = new URL(getExplorerUrl("abc")).origin;
    const acctBase = new URL(getAccountExplorerUrl("GABC")).origin;
    expect(txBase).toBe(acctBase);
  });
});
