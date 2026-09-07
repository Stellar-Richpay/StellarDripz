/**
 * Shared amount formatting for Stellar balances.
 *
 * The 7-digit fixed formatting for XLM and the 7/12-digit handling for
 * credit assets was previously duplicated with small variations across the
 * client horizon module, the direct RPC client, and the server horizon
 * service. Centralizing keeps display and comparisons consistent.
 */

/**
 * Format an XLM amount string (from Horizon/RPC) with exactly 7 fraction
 * digits and thousands separators, e.g. "1,234.5678901".
 */
export function formatXlmAmount(raw: string): string {
  const num = Number.parseFloat(raw);
  if (!Number.isFinite(num)) return "0.0000000";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 7,
    maximumFractionDigits: 7,
  });
}

/**
 * Maximum fractional digits Stellar allows for an asset: native and
 * credit_alphanum4 use 7, credit_alphanum12 uses up to 12. Centralized so
 * display formatting and input validation agree with the ledger.
 */
export function assetDecimals(assetType: string): number {
  return assetType === "credit_alphanum12" ? 12 : 7;
}

/**
 * Format a credit-asset amount. alphanum4 assets use 7 decimals, alphanum12
 * use up to 12, but display is capped at 7 to avoid unwieldy strings.
 */
export function formatAssetAmount(raw: string, assetType: string): string {
  const decimals = assetDecimals(assetType);
  const digits = Math.min(decimals, 7);
  const num = Number.parseFloat(raw);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
