/**
 * Tests for useTransactionHistory hook.
 */
import { renderHook, act, waitFor } from "@testing-library/react";

const mockFetchHistory = jest.fn();

jest.mock("@/lib/client/apiClient", () => ({
  fetchHistory: (...args: unknown[]) => mockFetchHistory(...args),
}));

let useTransactionHistory: typeof import("@/hooks/useTransactionHistory").useTransactionHistory;

beforeAll(async () => {
  const mod = await import("@/hooks/useTransactionHistory");
  useTransactionHistory = mod.useTransactionHistory;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchHistory.mockResolvedValue({
    transactions: [
      {
        id: "tx-1",
        type: "faucet",
        status: "success",
        hash: "hash1",
        amount: "10000",
        destinationAddress: "GDEST123",
        timestamp: 1700000000000,
      },
      {
        id: "tx-2",
        type: "send",
        status: "pending",
        hash: null,
        amount: "50",
        destinationAddress: "GDEST456",
        timestamp: 1700000001000,
        assetCode: "USDC",
      },
    ],
    total: 2,
    hasMore: true,
  });
});

describe("useTransactionHistory", () => {
  describe("initial state", () => {
    it("returns empty transactions when disabled", () => {
      const { result } = renderHook(() => useTransactionHistory({ enabled: false }));

      expect(result.current.transactions).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.total).toBe(0);
    });
  });

  describe("fetching", () => {
    it("fetches history on mount", async () => {
      const { result } = renderHook(() => useTransactionHistory());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.transactions.length).toBe(2);
      expect(result.current.transactions[0].id).toBe("tx-1");
      expect(result.current.transactions[0].type).toBe("faucet");
      expect(result.current.transactions[0].status).toBe("success");
      expect(result.current.transactions[0].hash).toBe("hash1");
      expect(result.current.total).toBe(2);
      expect(result.current.hasMore).toBe(true);
    });

    it("passes filters to the API", async () => {
      const { result } = renderHook(() =>
        useTransactionHistory({
          address: "GADDR_FILTER",
          type: "contract",
          limit: 10,
        }),
      );

      await waitFor(() => {
        expect(mockFetchHistory).toHaveBeenCalledWith("GADDR_FILTER", "contract", 10);
      });
    });

    it("maps API fields correctly", async () => {
      mockFetchHistory.mockResolvedValueOnce({
        transactions: [
          {
            id: "tx-contract-1",
            type: "contract",
            status: "success",
            hash: "cHash1",
            amount: "0",
            destinationAddress: "CCONTRACT123",
            timestamp: 1700000002000,
            contractId: "CSomeContract",
            functionName: "increment",
          },
        ],
        total: 1,
      });

      const { result } = renderHook(() => useTransactionHistory());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.transactions[0].contractId).toBe("CSomeContract");
      expect(result.current.transactions[0].functionName).toBe("increment");
      expect(result.current.transactions[0].timestamp).toBeInstanceOf(Date);
    });

    it("keeps a missing timestamp null instead of fabricating one", async () => {
      mockFetchHistory.mockResolvedValue({
        transactions: [
          {
            id: "tx-no-ts",
            type: "send",
            status: "success",
            hash: "hashNoTs",
            amount: "10",
            destinationAddress: "GDEST",
            // No timestamp field on purpose — the source may omit it.
          },
        ],
        total: 1,
      });

      const { result } = renderHook(() => useTransactionHistory());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // A fabricated "now" would misrepresent when the tx happened; it must
      // stay null so the UI can render an explicit "unknown".
      expect(result.current.transactions[0].timestamp).toBeNull();
    });

    it("handles error gracefully", async () => {
      mockFetchHistory.mockRejectedValueOnce(new Error("API down"));

      const { result } = renderHook(() => useTransactionHistory());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe("API down");
      expect(result.current.transactions).toEqual([]);
    });
  });

  describe("manual refresh", () => {
    it("refreshes transactions on demand", async () => {
      const { result } = renderHook(() => useTransactionHistory());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      jest.clearAllMocks();
      mockFetchHistory.mockResolvedValueOnce({
        transactions: [
          {
            id: "tx-fresh",
            type: "send",
            status: "success",
            hash: "freshHash",
            amount: "100",
            destinationAddress: "GNEW",
            timestamp: 1700000003000,
          },
        ],
        total: 1,
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.transactions.length).toBe(1);
      expect(result.current.transactions[0].id).toBe("tx-fresh");
    });
  });

  describe("auto-refresh", () => {
    it("polls at the specified interval", async () => {
      jest.useFakeTimers();

      const { result } = renderHook(() => useTransactionHistory({ refreshInterval: 5000 }));

      await waitFor(() => {
        expect(mockFetchHistory).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(mockFetchHistory).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it("does not poll when refreshInterval is 0", async () => {
      jest.useFakeTimers();

      const { result } = renderHook(() => useTransactionHistory({ refreshInterval: 0 }));

      await waitFor(() => {
        expect(mockFetchHistory).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(mockFetchHistory).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  describe("empty state", () => {
    it("handles empty transaction list", async () => {
      mockFetchHistory.mockResolvedValueOnce({
        transactions: [],
        total: 0,
      });

      const { result } = renderHook(() => useTransactionHistory());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.transactions).toEqual([]);
      expect(result.current.total).toBe(0);
    });
  });
});
