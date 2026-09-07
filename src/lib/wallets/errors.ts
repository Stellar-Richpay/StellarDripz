/**
 * Wallet error codes → user-facing messages.
 *
 * The wallet connectors throw short, machine-readable error codes
 * (USER_REJECTED, WALLET_NOT_INSTALLED, ...). This module is the single
 * place that maps them to friendly copy so the UI never shows a raw code.
 */
const WALLET_ERROR_MESSAGES: Record<string, string> = {
  UNSUPPORTED_WALLET: "This wallet is not supported yet.",
  WALLET_NOT_INSTALLED: "Wallet extension not detected. Install it and try again.",
  NO_ACCOUNT: "No account found in this wallet.",
  USER_REJECTED: "Connection rejected.",
  CONNECTION_FAILED: "Connection failed.",
  FREIGHTER_LOCKED: "Freighter is locked. Unlock it and try again.",
  XBULL_NOT_DETECTED: "xBull extension not detected.",
  XBULL_CONNECTION_FAILED: "Failed to connect to xBull.",
  ALBEDO_CONNECTION_FAILED: "Failed to connect to Albedo.",
  LOBSTR_NOT_CONNECTED: "LOBSTR is not connected.",
  LOBSTR_NOT_DETECTED: "LOBSTR extension not detected.",
  LOBSTR_CONNECTION_FAILED: "Failed to connect to LOBSTR.",
  LOBSTR_SIGN_FAILED: "Failed to sign with LOBSTR.",
  WC_NO_PROJECT_ID: "WalletConnect is not configured. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.",
  WC_NO_URI: "Could not start a WalletConnect pairing.",
  WC_NO_STELLAR_ACCOUNT: "The connected wallet has no Stellar account.",
  WC_NO_PUBLIC_KEY: "The connected wallet returned no public key.",
  WC_NOT_CONNECTED: "WalletConnect session is not connected. Reconnect and try again.",
  WC_TIMEOUT: "Pairing timed out. Close the QR and try again.",
};

/**
 * Convert a thrown value into a user-facing message.
 * Returns the value itself if it is a normal Error (already human-readable),
 * or the mapped copy for known wallet error codes.
 */
export function getWalletErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return WALLET_ERROR_MESSAGES[message] || message;
}

/** True when the error is one of our machine-readable wallet codes. */
export function isWalletErrorCode(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message in WALLET_ERROR_MESSAGES;
}
