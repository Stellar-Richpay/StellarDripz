import { validateMemo, validateAmount, validateAssetCode } from "@/lib/server/horizonService";

describe("validateMemo", () => {
  it("accepts empty / undefined memos", () => {
    expect(validateMemo()).toBeNull();
    expect(validateMemo("")).toBeNull();
    expect(validateMemo("   ")).toBeNull();
  });

  it("accepts memos up to 28 bytes", () => {
    expect(validateMemo("invoice-123")).toBeNull();
    expect(validateMemo("x".repeat(28))).toBeNull();
  });

  it("rejects memos over 28 bytes", () => {
    const err = validateMemo("x".repeat(29));
    expect(err).toMatch(/28 characters/);
  });

  it("counts UTF-8 bytes, not characters", () => {
    // 'é' is 2 bytes in UTF-8: 14 chars but 28 bytes → ok.
    expect(validateMemo("é".repeat(14))).toBeNull();
    // 15 'é' chars = 30 bytes → over the limit even though 15 chars.
    expect(validateMemo("é".repeat(15))).toMatch(/28 characters/);
  });
});

describe("validateAmount", () => {
  it("rejects zero, negative, and non-numeric amounts", () => {
    expect(validateAmount("0")).toMatch(/greater than zero/);
    expect(validateAmount("-5")).toMatch(/positive/);
    expect(validateAmount("abc")).toMatch(/positive number/);
    expect(validateAmount("")).toMatch(/required/);
  });

  it("enforces 7 decimals for XLM and 12 for credit assets", () => {
    expect(validateAmount("1.1234567")).toBeNull();
    expect(validateAmount("1.12345678")).toMatch(/too many decimal places/);
    expect(validateAmount("1.123456789012", "USDC")).toBeNull();
    expect(validateAmount("1.1234567890123", "USDC")).toMatch(/too many decimal places/);
  });
});

describe("validateAssetCode", () => {
  it("accepts 1-12 uppercase alphanumerics", () => {
    expect(validateAssetCode("XLM")).toBeNull();
    expect(validateAssetCode("USDC")).toBeNull();
    expect(validateAssetCode("GOLD2026")).toBeNull();
  });

  it("rejects lowercase, symbols, and empty codes", () => {
    expect(validateAssetCode("usdc")).toMatch(/Invalid asset code/);
    expect(validateAssetCode("US-C")).toMatch(/Invalid asset code/);
    expect(validateAssetCode("")).toMatch(/Invalid asset code/);
  });
});
