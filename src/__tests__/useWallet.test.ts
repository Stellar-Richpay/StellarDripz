/**
 * Tests for useWallet hook.
 */
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock wallet kit
const mockConnectWithWallet = jest.fn();
const mockClearPersistedWallet = jest.fn();
const mockCheckAnyWalletInstalled = jest.fn();
const mockGetSupportedWallets = jest.fn();
const mockLoadPersistedWallet = jest.fn();
const mockResetKit = jest.fn();
const mockConnectAndRegister = jest.fn();

jest.mock("@/lib/wallets/walletKit", () => ({
  connectWithWallet: (...args: unknown[]) => mockConnectWithWallet(...args),
  clearPersistedWallet: () => mockClearPersistedWallet(),
  checkAnyWalletInstalled: () => mockCheckAnyWalletInstalled(),
  getSupportedWallets: () => mockGetSupportedWallets(),
  loadPersistedWallet: () => mockLoadPersistedWallet(),
  resetKit: () => mockResetKit(),
}));

jest.mock("@/lib/client/walletClient", () => ({
  connectAndRegister: (...args: unknown[]) => mockConnectAndRegister(...args),
}));

// Dynamic import after mocks
let useWallet: typeof import("@/hooks/useWallet").useWallet;

beforeAll(async () => {
  const mod = await import("@/hooks/useWallet");
  useWallet = mod.useWallet;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckAnyWalletInstalled.mockReturnValue(true);
  mockGetSupportedWallets.mockReturnValue([
    { id: "freighter", name: "Freighter", iconUrl: "", installed: true },
    { id: "xbull", name: "xBull", iconUrl: "", installed: false },
  ]);
  mockLoadPersistedWallet.mockReturnValue(null);
  mockConnectWithWallet.mockResolvedValue({
    publicKey: "GPUBKEY123456789012345678901234567890123456",
    network: "TESTNET",
    walletId: "freighter",
    walletName: "Freighter",
  });
  mockConnectAndRegister.mockResolvedValue(undefined);
});

describe("useWallet", () => {
  describe("initial state", () => {
    it("returns disconnected state by default", () => {
      const { result } = renderHook(() => useWallet());

      expect(result.current.wallet.connected).toBe(false);
      expect(result.current.wallet.publicKey).toBeNull();
      expect(result.current.wallet.network).toBe("UNKNOWN");
      expect(result.current.connecting).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("initialises wallet availability", () => {
      const { result } = renderHook(() => useWallet());

      expect(result.current.wallet.isAnyWalletInstalled).toBe(true);
      expect(result.current.wallet.availableWallets.length).toBe(2);
      expect(mockCheckAnyWalletInstalled).toHaveBeenCalled();
    });

    it("auto-connects if persisted wallet exists", async () => {
      mockLoadPersistedWallet.mockReturnValue({ walletId: "freighter" });

      const { result } = renderHook(() => useWallet());

      await waitFor(() => {
        expect(mockConnectWithWallet).toHaveBeenCalledWith("freighter");
      });

      await waitFor(() => {
        expect(result.current.wallet.connected).toBe(true);
      });
    });

    it("handles auto-connect failure gracefully", async () => {
      mockLoadPersistedWallet.mockReturnValue({ walletId: "freighter" });
      mockConnectWithWallet.mockRejectedValue(new Error("CONNECTION_FAILED"));

      const { result } = renderHook(() => useWallet());

      await waitFor(() => {
        expect(mockClearPersistedWallet).toHaveBeenCalled();
      });

      // Should remain disconnected and surface the reason instead of
      // silently dropping the user on a disconnected screen.
      await waitFor(() => {
        expect(result.current.wallet.connected).toBe(false);
      });
      expect(result.current.error).toBe("Connection failed.");
    });

    it("keeps the session when only backend registration fails on reconnect", async () => {
      mockLoadPersistedWallet.mockReturnValue({ walletId: "freighter" });
      mockConnectAndRegister.mockRejectedValue(new Error("NETWORK_ERROR"));

      const { result } = renderHook(() => useWallet());

      // Wallet stays connected and the persisted session is NOT cleared, so
      // the next page load will try to reconnect again.
      await waitFor(() => {
        expect(result.current.wallet.connected).toBe(true);
      });
      expect(mockClearPersistedWallet).not.toHaveBeenCalled();
      expect(result.current.error).toMatch(/session couldn't be registered/);
    });
  });

  describe("connect", () => {
    it("connects to a wallet successfully", async () => {
      const { result } = renderHook(() => useWallet());

      await act(async () => {
        await result.current.connect("freighter");
      });

      expect(result.current.wallet.connected).toBe(true);
      expect(result.current.wallet.publicKey).toBe("GPUBKEY123456789012345678901234567890123456");
      expect(result.current.wallet.walletId).toBe("freighter");
      expect(result.current.wallet.network).toBe("TESTNET");
      expect(result.current.error).toBeNull();
      expect(mockConnectAndRegister).toHaveBeenCalledWith(
        "GPUBKEY123456789012345678901234567890123456",
        "freighter",
        "Freighter",
      );
    });

    it("sets error on connection failure", async () => {
      mockConnectWithWallet.mockRejectedValue(new Error("USER_REJECTED"));

      const { result } = renderHook(() => useWallet());

      await act(async () => {
        try {
          await result.current.connect("freighter");
        } catch {
          /* expected */
        }
      });

      expect(result.current.wallet.connected).toBe(false);
      expect(result.current.error).toBe("Connection rejected.");
    });
  });

  describe("disconnect", () => {
    it("clears wallet state on disconnect", async () => {
      const { result } = renderHook(() => useWallet());

      // First connect
      await act(async () => {
        await result.current.connect("freighter");
      });

      expect(result.current.wallet.connected).toBe(true);

      // Then disconnect
      act(() => {
        result.current.disconnect();
      });

      expect(result.current.wallet.connected).toBe(false);
      expect(result.current.wallet.publicKey).toBeNull();
      expect(mockClearPersistedWallet).toHaveBeenCalled();
      expect(mockResetKit).toHaveBeenCalled();
    });
  });

  describe("refreshWallets", () => {
    it("refreshes available wallet list", () => {
      const { result } = renderHook(() => useWallet());

      jest.clearAllMocks();
      mockCheckAnyWalletInstalled.mockReturnValue(false);
      mockGetSupportedWallets.mockReturnValue([]);

      act(() => {
        result.current.refreshWallets();
      });

      expect(result.current.wallet.isAnyWalletInstalled).toBe(false);
      expect(result.current.wallet.availableWallets).toEqual([]);
      expect(mockCheckAnyWalletInstalled).toHaveBeenCalled();
    });
  });
});
// Edge case: handles wallet disconnect during async operation
