/**
 * Tests for database service (transaction history and analytics)
 */
import {
  saveTransaction,
  getTransactions,
  getTransactionsCount,
  logAnalytics,
  getAnalyticsSummary,
  clearDb,
} from "@/lib/server/dbService";

beforeEach(async () => {
  await clearDb();
});

describe("dbService", () => {
  describe("saveTransaction and getTransactions", () => {
    it("saves and retrieves a transaction", async () => {
      const tx = {
        id: "tx-test-1",
        type: "faucet" as const,
        status: "success" as const,
        hash: "abc123hash",
        amount: "10000",
        senderAddress: "friendbot",
        destinationAddress: "GDEST123456789012345678901234567890123456",
        timestamp: Date.now(),
      };

      await saveTransaction(tx);
      const transactions = await getTransactions();
      expect(transactions).toHaveLength(1);
      expect(transactions[0].id).toBe("tx-test-1");
      expect(transactions[0].type).toBe("faucet");
    });

    it("filters transactions by type", async () => {
      await saveTransaction({
        id: "tx-1",
        type: "faucet",
        status: "success",
        hash: "h1",
        amount: "10000",
        senderAddress: "f",
        destinationAddress: "d1",
        timestamp: Date.now(),
      });
      await saveTransaction({
        id: "tx-2",
        type: "send",
        status: "success",
        hash: "h2",
        amount: "50",
        senderAddress: "d1",
        destinationAddress: "d2",
        timestamp: Date.now(),
      });
      await saveTransaction({
        id: "tx-3",
        type: "contract",
        status: "success",
        hash: "h3",
        amount: "0",
        senderAddress: "d1",
        destinationAddress: "c1",
        timestamp: Date.now(),
      });

      const faucetTxs = await getTransactions(undefined, "faucet");
      expect(faucetTxs).toHaveLength(1);
      expect(faucetTxs[0].id).toBe("tx-1");
    });

    it("limits return count", async () => {
      for (let i = 0; i < 30; i++) {
        await saveTransaction({
          id: `tx-${i}`,
          type: "faucet",
          status: "success",
          hash: `h${i}`,
          amount: "10000",
          senderAddress: "f",
          destinationAddress: `d${i}`,
          timestamp: Date.now() + i,
        });
      }

      const transactions = await getTransactions(undefined, undefined, 10);
      expect(transactions).toHaveLength(10);
      if (transactions.length >= 2) {
        expect(transactions[0].timestamp).toBeGreaterThan(transactions[9].timestamp);
      }
    });

    it("counts transactions with the same filters as getTransactions", async () => {
      await saveTransaction({
        id: "tx-c1",
        type: "faucet",
        status: "success",
        hash: "h1",
        amount: "10000",
        senderAddress: "f",
        destinationAddress: "d1",
        timestamp: Date.now(),
      });
      await saveTransaction({
        id: "tx-c2",
        type: "send",
        status: "success",
        hash: "h2",
        amount: "50",
        senderAddress: "f",
        destinationAddress: "d2",
        timestamp: Date.now(),
      });

      expect(await getTransactionsCount()).toBe(2);
      expect(await getTransactionsCount("f")).toBe(2);
      expect(await getTransactionsCount("f", "faucet")).toBe(1);
      expect(await getTransactionsCount("nobody")).toBe(0);
      // Count is unaffected by paging parameters.
      expect((await getTransactions(undefined, undefined, 1)).length).toBe(1);
      expect(await getTransactionsCount()).toBe(2);
    });
  });

  describe("logAnalytics and getAnalyticsSummary", () => {
    it("logs and retrieves analytics events", async () => {
      await logAnalytics({ eventType: "faucet_request", address: "0xaddr1" });
      await logAnalytics({ eventType: "faucet_request", address: "0xaddr1" });
      await logAnalytics({ eventType: "contract_invoke", address: "0xaddr2" });

      const summary = await getAnalyticsSummary();
      expect(summary["faucet_request"].total).toBe(2);
      expect(summary["contract_invoke"].total).toBe(1);
    });

    it("tracks unique addresses", async () => {
      await logAnalytics({ eventType: "wallet_connect", address: "address1" });
      await logAnalytics({ eventType: "wallet_connect", address: "address1" });
      await logAnalytics({ eventType: "wallet_connect", address: "address2" });

      const summary = await getAnalyticsSummary();
      expect(summary["wallet_connect"].uniqueAddresses).toBe(2);
    });
  });
});
