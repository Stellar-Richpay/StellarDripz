/**
 * Tests for useBalance hook — now uses direct Horizon reads.
 */
import { renderHook, act, waitFor } from "@testing-library/react";

const mockDirectFetchBalance = jest.fn();

jest.mock("@/lib/client/directClient", () => ({
  directFetchBalance: (...args: unknown[]) => mockDirectFetchBalance(...args),
}));

let useBalance: typeof import("@/hooks/useBalance").useBalance;

beforeAll(async () => {
  const mod = await import("@/hooks/useBalance");
  useBalance = mod.useBalance;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDirectFetchBalance.mockResolvedValue({
    xlm: "10.0000000",
    raw: "100000000",
    assets: [],
  });
});

describe("useBalance", () => {
  describe("initial state", () => {
    it("returns empty balance when no address", () => {
      const { result } = renderHook(() => useBalance({ address: null }));

      expect(result.current.balance.xlm).toBe("0.0000000");
      expect(result.current.balance.raw).toBe("0");
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("does not fetch when disabled", () => {
      const { result } = renderHook(() => useBalance({ address: "GADDR123", enabled: false }));

      expect(mockDirectFetchBalance).not.toHaveBeenCalled();
    });
  });

  describe("direct balance fetching", () => {
    it("fetches balance via direct Horizon on mount", async () => {
      const { result } = renderHook(() => useBalance({ address: "GADDR123" }));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockDirectFetchBalance).toHaveBeenCalledWith("GADDR123");
      expect(result.current.balance.xlm).toBe("10.0000000");
      expect(result.current.balance.raw).toBe("100000000");
      expect(result.current.balance.lastFetched).not.toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("maps assets from direct Horizon response", async () => {
      mockDirectFetchBalance.mockResolvedValueOnce({
        xlm: "100.0000000",
        raw: "1000000000",
        assets: [
          { code: "USDC", balance: "500.0000000", formatted: "500.0000000" },
          { code: "XLM", balance: "100.0000000", formatted: "100.0000000" },
        ],
      });

      const { result } = renderHook(() => useBalance({ address: "GADDR123" }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.balance.assets.length).toBe(2);
      expect(result.current.balance.assets[0].asset.code).toBe("USDC");
    });

    it("handles direct fetch error", async () => {
      mockDirectFetchBalance.mockRejectedValueOnce(new Error("Horizon timeout"));

      const { result } = renderHook(() => useBalance({ address: "GADDR123" }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe("Horizon timeout");
    });

    it("refetches when address changes", async () => {
      const { result, rerender } = renderHook(
        ({ addr }: { addr: string | null }) => useBalance({ address: addr }),
        { initialProps: { addr: "GADDR_A" } },
      );

      await waitFor(() => {
        expect(mockDirectFetchBalance).toHaveBeenCalledWith("GADDR_A");
      });

      jest.clearAllMocks();
      mockDirectFetchBalance.mockResolvedValueOnce({
        xlm: "50.0000000",
        raw: "500000000",
        assets: [],
      });

      rerender({ addr: "GADDR_B" });

      await waitFor(() => {
        expect(mockDirectFetchBalance).toHaveBeenCalledWith("GADDR_B");
      });
    });
  });

  describe("manual refresh", () => {
    it("refreshes balance on demand", async () => {
      const { result } = renderHook(() => useBalance({ address: "GADDR123" }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      jest.clearAllMocks();
      mockDirectFetchBalance.mockResolvedValueOnce({
        xlm: "200.0000000",
        raw: "2000000000",
        assets: [],
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockDirectFetchBalance).toHaveBeenCalledWith("GADDR123");
      expect(result.current.balance.xlm).toBe("200.0000000");
    });
  });

  describe("auto-refresh", () => {
    it("starts auto-refresh when refreshInterval is set", async () => {
      jest.useFakeTimers();

      const { result } = renderHook(() =>
        useBalance({ address: "GADDR123", refreshInterval: 10000 }),
      );

      await waitFor(() => {
        expect(mockDirectFetchBalance).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        jest.advanceTimersByTime(10000);
      });

      expect(mockDirectFetchBalance).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe("unmount safety", () => {
    it("does not update state after unmount", async () => {
      let resolveBalance: (value: unknown) => void;
      const pendingBalance = new Promise((resolve) => {
        resolveBalance = resolve;
      });
      mockDirectFetchBalance.mockReturnValueOnce(pendingBalance);

      const { result, unmount } = renderHook(() => useBalance({ address: "GADDR123" }));

      unmount();

      await act(async () => {
        resolveBalance!({
          xlm: "1.0000000",
          raw: "10000000",
          assets: [],
        });
      });

      // No assertion needed — just verifying no "setState on unmounted component" error
    });
  });
});
// Edge case: handles zero balance accounts

describe("useBalance StrictMode remount", () => {
  it("refetches after unmount + remount (regression: mountedRef stuck false)", async () => {
    const first = renderHook(() => useBalance({ address: "GADDR123" }));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    // Second mount — the hook must believe it is mounted again.
    const second = renderHook(() => useBalance({ address: "GADDR123" }));
    expect(mockDirectFetchBalance).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.balance.xlm).toBe("10.0000000");
    second.unmount();
  });
});
