/**
 * Wallet client — registers wallet sessions with the backend API.
 * Used by AppContext after successful wallet connection.
 */
import { request } from "./apiClient";

export interface WalletRegistration {
  success: boolean;
  session: {
    address: string;
    walletId: string;
    connectedAt: number;
  };
}

/**
 * Register a newly connected wallet with the backend for session tracking.
 */
export async function connectAndRegister(
  address: string,
  walletId: string,
  walletName: string,
): Promise<WalletRegistration> {
  return request<WalletRegistration>("/api/wallet/connect", {
    method: "POST",
    body: JSON.stringify({ address, walletId, walletName }),
  });
}

/**
 * End the server-side session when the user disconnects. Best-effort: a
 * failure here must not block the local disconnect UX.
 */
export async function disconnectAndUnregister(address: string): Promise<void> {
  try {
    await request<{ success: boolean }>("/api/wallet/disconnect", {
      method: "POST",
      body: JSON.stringify({ address }),
    });
  } catch {
    /* best-effort — session TTL cleanup will handle stragglers */
  }
}
