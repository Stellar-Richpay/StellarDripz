import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BadgeGallery from "@/components/BadgeGallery";

const mockGetAppConfig = jest.fn();
jest.mock("@/lib/env", () => ({
  getAppConfig: () => mockGetAppConfig(),
}));

const mockDirectReadContract = jest.fn();
jest.mock("@/lib/client/directClient", () => ({
  directReadContract: (...args: unknown[]) => mockDirectReadContract(...args),
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

describe("BadgeGallery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders null when badgeId is not configured", () => {
    mockGetAppConfig.mockReturnValue({ contractIdBadge: null });
    const { container } = render(<BadgeGallery />);
    expect(container.firstChild).toBeNull();
  });

  it("renders badges and allows claiming an unearned badge", async () => {
    mockGetAppConfig.mockReturnValue({
      contractIdBadge: "CAZFH3S7JUEI7LZSQGHMM6OF5UKWLNZ3CSOX2KNUX3RBFPP5Q6GEEUWE",
    });

    mockDirectReadContract.mockImplementation((_id, fn) => {
      if (fn === "list_badges") {
        return Promise.resolve({
          result: [
            { id: 1, name: "Genesis Staker", description: "First stake", image_uri: "", tier: 1 },
          ],
        });
      }
      if (fn === "list_user_badges") {
        return Promise.resolve({ result: [] }); // unearned
      }
      return Promise.resolve({ result: null });
    });

    mockBuildContractCall.mockResolvedValue({ xdr: "AAAA..." });
    mockSignTx.mockResolvedValue("BBBB...");
    mockSubmitContract.mockResolvedValue({ hash: "txhash999" });

    render(<BadgeGallery />);

    await waitFor(() => {
      expect(screen.getByText("Genesis Staker")).toBeInTheDocument();
      expect(screen.getByText("Claim")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Claim"));

    await waitFor(() => {
      expect(mockBuildContractCall).toHaveBeenCalledWith(
        "CAZFH3S7JUEI7LZSQGHMM6OF5UKWLNZ3CSOX2KNUX3RBFPP5Q6GEEUWE",
        "claim_badge",
        ["GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", { u64: 1 }],
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      );
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "success", title: "Badge Claimed! 🎖️" }),
      );
    });
  });
});
