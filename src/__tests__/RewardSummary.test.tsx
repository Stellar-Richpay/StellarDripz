import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RewardSummary from "@/components/RewardSummary";

const mockGetAppConfig = jest.fn();
jest.mock("@/lib/env", () => ({
  getAppConfig: () => mockGetAppConfig(),
}));

const mockDirectReadContract = jest.fn();
const mockDirectGetLatestLedger = jest.fn();
jest.mock("@/lib/client/directClient", () => ({
  directReadContract: (...args: unknown[]) => mockDirectReadContract(...args),
  directGetLatestLedger: () => mockDirectGetLatestLedger(),
}));

const mockBuildContractCall = jest.fn();
const mockSubmitContract = jest.fn();
jest.mock("@/lib/client/apiClient", () => ({
  buildContractCall: (...args: unknown[]) => mockBuildContractCall(...args),
  submitContract: (...args: unknown[]) => mockSubmitContract(...args),
}));

const mockSignTx = jest.fn();
jest.mock("@/lib/wallets/walletKit", () => ({
  signTx: (...args: unknown[]) => mockSignTx(...args),
}));

const mockShowToast = jest.fn();
jest.mock("@/components/Toast", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

const mockState = {
  wallet: {
    connected: true,
    publicKey: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    walletId: "freighter",
  },
};

jest.mock("@/context/AppContext", () => ({
  useAppContext: () => ({
    state: mockState,
  }),
}));

describe("RewardSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDirectGetLatestLedger.mockResolvedValue(250);
  });

  it("renders null when poolId is not configured", () => {
    mockGetAppConfig.mockReturnValue({ contractIdDripPool: null });
    const { container } = render(<RewardSummary />);
    expect(container.firstChild).toBeNull();
  });

  it("renders staking position and triggers claim rewards", async () => {
    mockGetAppConfig.mockReturnValue({
      contractIdDripPool: "CCBNJTZ22HDJTQHIINS22FNIK5KRYIW3CPORFAKNCBMWWL7SRJMZIR6X",
    });

    mockDirectReadContract.mockImplementation((_id, fn) => {
      if (fn === "get_stake") {
        return Promise.resolve({
          result: { amount: BigInt(20000000), start_ledger: 100, reward_claimed: BigInt(1000) },
        });
      }
      if (fn === "calculate_reward") {
        return Promise.resolve({ result: BigInt(5000000) });
      }
      if (fn === "get_pool_config") {
        return Promise.resolve({ result: { reward_rate: BigInt(50000), lock_period: 100 } });
      }
      return Promise.resolve({ result: null });
    });

    mockBuildContractCall.mockResolvedValue({ xdr: "AAAA..." });
    mockSignTx.mockResolvedValue("BBBB...");
    mockSubmitContract.mockResolvedValue({ hash: "txhash456" });

    render(<RewardSummary />);

    await waitFor(() => {
      expect(screen.getByText("Claim Rewards")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Claim Rewards"));

    await waitFor(() => {
      expect(mockBuildContractCall).toHaveBeenCalledWith(
        "CCBNJTZ22HDJTQHIINS22FNIK5KRYIW3CPORFAKNCBMWWL7SRJMZIR6X",
        "claim_reward",
        ["GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"],
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      );
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "success", title: "Rewards Claimed! 🎉" }),
      );
    });
  });

  it("allows unstaking when lock period has elapsed", async () => {
    mockGetAppConfig.mockReturnValue({
      contractIdDripPool: "CCBNJTZ22HDJTQHIINS22FNIK5KRYIW3CPORFAKNCBMWWL7SRJMZIR6X",
    });

    mockDirectReadContract.mockImplementation((_id, fn) => {
      if (fn === "get_stake") {
        return Promise.resolve({
          result: { amount: BigInt(20000000), start_ledger: 100, reward_claimed: BigInt(0) },
        });
      }
      if (fn === "calculate_reward") {
        return Promise.resolve({ result: BigInt(0) });
      }
      if (fn === "get_pool_config") {
        return Promise.resolve({ result: { reward_rate: BigInt(50000), lock_period: 100 } });
      }
      return Promise.resolve({ result: null });
    });

    mockBuildContractCall.mockResolvedValue({ xdr: "AAAA..." });
    mockSignTx.mockResolvedValue("BBBB...");
    mockSubmitContract.mockResolvedValue({ hash: "txhash789" });

    render(<RewardSummary />);

    await waitFor(() => {
      expect(screen.getByText("Unstake")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Unstake"));

    await waitFor(() => {
      expect(screen.getByText("Confirm")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => {
      expect(mockBuildContractCall).toHaveBeenCalledWith(
        "CCBNJTZ22HDJTQHIINS22FNIK5KRYIW3CPORFAKNCBMWWL7SRJMZIR6X",
        "unstake",
        ["GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", "20000000"],
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      );
    });
  });
});
