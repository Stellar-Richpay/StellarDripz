import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GovernanceDashboard from "@/components/GovernanceDashboard";

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

describe("GovernanceDashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDirectGetLatestLedger.mockResolvedValue(150);
  });

  it("renders configuration guide when contract ID is not configured", () => {
    mockGetAppConfig.mockReturnValue({ contractIdGovernance: null });
    render(<GovernanceDashboard />);
    expect(screen.getByText(/Governance Contract/i)).toBeInTheDocument();
    expect(screen.getByText(/NEXT_PUBLIC_CONTRACT_GOVERNANCE/i)).toBeInTheDocument();
  });

  it("loads and displays proposals and voting power", async () => {
    mockGetAppConfig.mockReturnValue({
      contractIdGovernance: "CD3NIJCGVECTGPOUQOWYERWXQMOXJFSX6AKVI4KZVXGO4ZBYO7G6AIVH",
    });

    mockDirectReadContract.mockImplementation((_id, fn) => {
      if (fn === "list_proposals") {
        return Promise.resolve({
          result: [
            {
              id: 1,
              proposer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
              title: "Upgrade Staking Pool",
              description: "Increase rewards rate by 20%",
              for_votes: BigInt(10000000),
              against_votes: BigInt(0),
              abstain_votes: BigInt(0),
              created_ledger: 100,
              voting_end: 200,
              executed: false,
              passed: false,
            },
          ],
        });
      }
      if (fn === "get_voting_power") {
        return Promise.resolve({ result: BigInt(50000000) });
      }
      if (fn === "get_quorum") {
        return Promise.resolve({ result: 1000 });
      }
      return Promise.resolve({ result: null });
    });

    render(<GovernanceDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Upgrade Staking Pool")).toBeInTheDocument();
    });

    expect(screen.getByText(/5 DRIP/i)).toBeInTheDocument();
    expect(screen.getByText(/10.0%/i)).toBeInTheDocument();
    expect(screen.getByText(/Voting Active/i)).toBeInTheDocument();
  });

  it("allows voting on active proposals", async () => {
    mockGetAppConfig.mockReturnValue({
      contractIdGovernance: "CD3NIJCGVECTGPOUQOWYERWXQMOXJFSX6AKVI4KZVXGO4ZBYO7G6AIVH",
    });

    mockDirectReadContract.mockImplementation((_id, fn) => {
      if (fn === "list_proposals") {
        return Promise.resolve({
          result: [
            {
              id: 1,
              proposer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
              title: "Upgrade Staking Pool",
              description: "Increase rewards rate by 20%",
              for_votes: BigInt(10000000),
              against_votes: BigInt(0),
              abstain_votes: BigInt(0),
              created_ledger: 100,
              voting_end: 200,
              executed: false,
              passed: false,
            },
          ],
        });
      }
      if (fn === "get_voting_power") return Promise.resolve({ result: BigInt(50000000) });
      if (fn === "get_quorum") return Promise.resolve({ result: 0 });
      return Promise.resolve({ result: null });
    });

    mockBuildContractCall.mockResolvedValue({ xdr: "AAAA..." });
    mockSignTx.mockResolvedValue("BBBB...");
    mockSubmitContract.mockResolvedValue({ hash: "txhash123" });

    render(<GovernanceDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Vote For 👍")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Vote For 👍"));

    await waitFor(() => {
      expect(mockBuildContractCall).toHaveBeenCalledWith(
        "CD3NIJCGVECTGPOUQOWYERWXQMOXJFSX6AKVI4KZVXGO4ZBYO7G6AIVH",
        "vote",
        ["GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", 1, 0],
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      );
      expect(mockSignTx).toHaveBeenCalledWith("freighter", "AAAA...");
      expect(mockSubmitContract).toHaveBeenCalledWith(
        "CD3NIJCGVECTGPOUQOWYERWXQMOXJFSX6AKVI4KZVXGO4ZBYO7G6AIVH",
        "vote",
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        "BBBB...",
      );
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "success", title: "Vote Cast! 🗳️" }),
      );
    });
  });
});
