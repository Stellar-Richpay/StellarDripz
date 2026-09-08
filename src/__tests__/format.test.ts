/**
 * Tests for the shared Stellar amount formatting helpers.
 *
 * formatXlmAmount / formatAssetAmount / assetDecimals are used everywhere
 * balances are shown (server horizon service, direct client, components), so
 * their edge-case behavior deserves to be pinned: non-finite inputs, native
 * vs credit assets, and the 7-vs-12 decimal distinction.
 */
import { formatXlmAmount, formatAssetAmount, assetDecimals } from "@/lib/stellar/format";

describe("assetDecimals", () => {
  it("uses 7 decimals for native and alphanum4 assets, 12 for alphanum12", () => {
    expect(assetDecimals("native")).toBe(7);
    expect(assetDecimals("credit_alphanum4")).toBe(7);
    expect(assetDecimals("credit_alphanum12")).toBe(12);
    // Unknown types default to the strictest common precision.
    expect(assetDecimals("something_else")).toBe(7);
  });
});

describe("formatXlmAmount", () => {
  it("formats with exactly 7 fraction digits and thousands separators", () => {
    expect(formatXlmAmount("1234.5")).toBe("1,234.5000000");
    expect(formatXlmAmount("0")).toBe("0.0000000");
  });

  it("returns the zero placeholder for non-finite input", () => {
    expect(formatXlmAmount("abc")).toBe("0.0000000");
    expect(formatXlmAmount("")).toBe("0.0000000");
    expect(formatXlmAmount("NaN")).toBe("0.0000000");
  });

  it("handles very large balances without exponent notation", () => {
    const out = formatXlmAmount("123456789012345678901");
    expect(out).toContain(",");
    expect(out).not.toContain("e");
  });
});

describe("formatAssetAmount", () => {
  it("formats alphanum4 with 7 digits and alphanum12 with up to 7 shown", () => {
    expect(formatAssetAmount("100.5", "credit_alphanum4")).toBe("100.5000000");
    expect(formatAssetAmount("100.5", "credit_alphanum12")).toBe("100.5000000");
  });

  it("returns '0' for non-finite input", () => {
    expect(formatAssetAmount("not-a-number", "credit_alphanum4")).toBe("0");
  });

  it("rounds fractional display to the asset's precision", () => {
    // alphanum12 amounts keep their full precision internally but display is
    // capped at 7 digits to avoid unwieldy strings.
    expect(formatAssetAmount("1.123456789012", "credit_alphanum12")).toBe("1.1234568");
  });
});
