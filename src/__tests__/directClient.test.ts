/**
 * Tests for the direct Stellar client (browser-side reads).
 */
import {
  directFetchBalance,
  directSimulateContract,
  directFetchContractEvents,
  directGetLatestLedger,
} from "@/lib/client/directClient";

// Mock @stellar/stellar-sdk
const mockLoadAccount = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockGetEvents = jest.fn();
const mockGetLatestLedger = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: (...args: unknown[]) => mockLoadAccount(...args),
    })),
  },
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      simulateTransaction: (...args: unknown[]) => mockSimulateTransaction(...args),
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
      getLatestLedger: (...args: unknown[]) => mockGetLatestLedger(...args),
    })),
    Api: {
      isSimulationError: jest.fn().mockReturnValue(false),
      GetTransactionStatus: {
        SUCCESS: "SUCCESS",
        NOT_FOUND: "NOT_FOUND",
        FAILED: "FAILED",
      },
    },
    assembleTransaction: jest.fn((tx: unknown, sim: unknown) => ({
      built: { toXDR: () => "AAAA...==" },
    })),
  },
  Contract: jest.fn().mockImplementation((id: string) => ({
    call: jest.fn().mockReturnValue({}),
  })),
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({}),
  })),
  scValToNative: jest.fn(),
  xdr: {
    ScVal: {
      fromXDR: jest.fn().mockReturnValue({}),
    },
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  Asset: { native: jest.fn() },
  StrKey: { decodeEd25519PublicKey: jest.fn(), encodeContract: jest.fn() },
}));

// Mock network config
jest.mock("@/lib/stellar/network", () => ({
  STELLAR_NETWORK: {
    horizonUrl: "https://horizon-testnet.stellar.org",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    friendbotUrl: "https://friendbot.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("directClient", () => {
  describe("directFetchBalance", () => {
    it("fetches and parses balance from Horizon", async () => {
      mockLoadAccount.mockResolvedValueOnce({
        balances: [
          {
            asset_type: "native",
            balance: "100.0000000",
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            balance: "50.0000",
          },
        ],
      });

      const result = await directFetchBalance("GADDR123");
      expect(result.xlm).toBeTruthy();
      expect(result.raw).toBe("100.0000000");
      expect(result.assets.length).toBe(1);
      expect(result.assets[0].code).toBe("USDC");
      expect(mockLoadAccount).toHaveBeenCalledWith("GADDR123");
    });

    it("returns zero balance for unfunded account", async () => {
      mockLoadAccount.mockResolvedValueOnce({
        balances: [{ asset_type: "native", balance: "0" }],
      });

      const result = await directFetchBalance("GADDR123");
      expect(result.xlm).toBeTruthy();
    });
  });

  describe("directSimulateContract", () => {
    it("simulates and returns result", async () => {
      mockLoadAccount.mockResolvedValueOnce({});
      mockSimulateTransaction.mockResolvedValueOnce({
        result: { retval: "test" },
      });

      const result = await directSimulateContract("CCONTRACT", "get_counter", [], "GSIGNER123");
      expect(result).toHaveProperty("resultValue");
    });
  });

  describe("directFetchContractEvents", () => {
    it("fetches events from Soroban RPC", async () => {
      mockGetEvents.mockResolvedValueOnce({
        events: [
          {
            topic: ["increment"],
            ledger: 5001,
            value: "base64value",
          },
        ],
      });

      const result = await directFetchContractEvents("CCONTRACT", 0);
      expect(result.events.length).toBe(1);
      expect(result.latestLedger).toBe(5001);
    });

    it("returns empty on fetch error", async () => {
      mockGetEvents.mockRejectedValueOnce(new Error("RPC down"));

      const result = await directFetchContractEvents("CCONTRACT", 0);
      expect(result.events).toEqual([]);
    });
  });

  describe("directGetLatestLedger", () => {
    it("returns latest ledger sequence", async () => {
      mockGetLatestLedger.mockResolvedValueOnce({ sequence: 99999 });

      const result = await directGetLatestLedger();
      expect(result).toBe(99999);
    });

    it("returns 0 on error", async () => {
      mockGetLatestLedger.mockRejectedValueOnce(new Error("RPC down"));

      const result = await directGetLatestLedger();
      expect(result).toBe(0);
    });
  });
});
