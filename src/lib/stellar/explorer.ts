/**
 * Stellar explorer URL helpers.
 *
 * getExplorerUrl previously lived in the client horizon module, which
 * otherwise only contained browser→Horizon operations that were superseded
 * by directClient (reads) and the server horizon service (writes). The
 * explorer link is the one piece of that module still used by the app, so
 * it lives here on its own.
 */
import { STELLAR_NETWORK } from "./network";

/** Link to a transaction hash on the active network's explorer. */
export function getExplorerUrl(hash: string): string {
  return `${STELLAR_NETWORK.stellarExpertUrl}/tx/${hash}`;
}

/** Link to an account address on the active network's explorer. */
export function getAccountExplorerUrl(address: string): string {
  return `${STELLAR_NETWORK.stellarExpertUrl}/account/${address}`;
}

/** Link to a contract address on the active network's explorer. */
export function getContractExplorerUrl(contractId: string): string {
  return `${STELLAR_NETWORK.contractExplorerUrl}/${contractId}`;
}
