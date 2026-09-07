/**
 * Session manager for wallet connections.
 * Validates and tracks wallet sessions server-side.
 */
import type { SessionEntry } from "./dbService";
import { saveSession, getSession, logAnalytics } from "./dbService";

export async function createSession(
  address: string,
  walletId: string,
  walletName: string,
  requestInfo: { ip?: string; userAgent?: string },
): Promise<SessionEntry> {
  const now = Date.now();
  const existing = await getSession(address);

  const session: SessionEntry = {
    address,
    walletId,
    walletName,
    connectedAt: existing?.connectedAt || now,
    lastActive: now,
    ip: requestInfo.ip,
  };

  await saveSession(session);
  await logAnalytics({ eventType: "wallet_connect", address, data: { walletId, walletName } });

  return session;
}
