/**
 * Stellar Mainnet configuration.
 *
 * This module is ready for production deployment. To switch from testnet
 * to mainnet, set NEXT_PUBLIC_STELLAR_NETWORK=MAINNET in your environment
 * and ensure:
 * 1. Contracts are deployed to mainnet (use DEPLOYER_SECRET_KEY with real XLM)
 * 2. All NEXT_PUBLIC_CONTRACT_* IDs are updated to mainnet contract IDs
 * 3. Friendbot is disabled (mainnet has no free XLM faucet)
 * 4. Rate limits are appropriately tightened
 * 5. External audit is complete (SCF Audit Bank)
 *
 * SCF Tranche 3 deliverable: Mainnet deployment.
 */
import { getAppConfig } from "@/lib/env";

export interface MainnetConfig {
  network: "MAINNET";
  sorobanRpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  stellarExpertUrl: string;
  contractExplorerUrl: string;
}

const MAINNET_DEFAULTS: MainnetConfig = {
  network: "MAINNET",
  sorobanRpcUrl: "https://soroban-rpc.stellar.org",
  horizonUrl: "https://horizon.stellar.org",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  stellarExpertUrl: "https://stellar.expert/explorer/public",
  contractExplorerUrl: "https://stellar.expert/explorer/public/contract",
};

/**
 * Get mainnet configuration, overriding defaults with environment variables.
 */
export function getMainnetConfig(): MainnetConfig {
  const config = getAppConfig();
  if (config.isTestnet) {
    throw new Error(
      "Mainnet config requested but NEXT_PUBLIC_STELLAR_NETWORK is not set to mainnet. " +
        "Set NEXT_PUBLIC_STELLAR_NETWORK=MAINNET to enable mainnet mode.",
    );
  }

  return {
    ...MAINNET_DEFAULTS,
    sorobanRpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || MAINNET_DEFAULTS.sorobanRpcUrl,
    horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL || MAINNET_DEFAULTS.horizonUrl,
    networkPassphrase:
      process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || MAINNET_DEFAULTS.networkPassphrase,
  };
}

/**
 * Check if mainnet mode is active.
 */
export function isMainnet(): boolean {
  return !getAppConfig().isTestnet;
}

/**
 * Mainnet rate limit defaults (stricter than testnet).
 *
 * Mainnet deliberately ignores the RATE_LIMIT_*_MS environment overrides:
 * real XLM is at stake, so operators cannot accidentally loosen the buckets
 * by shipping a dev-tuned .env to production. Overrides only apply on
 * testnet deployments (see getLimitConfig in src/lib/server/rateLimiter.ts).
 */
export const MAINNET_RATE_LIMITS = {
  faucet: { windowMs: 86_400_000, maxRequests: 1 }, // 1 per day
  payment: { windowMs: 60_000, maxRequests: 5 }, // 5 per minute
  contract: { windowMs: 60_000, maxRequests: 3 }, // 3 per minute
  wallet: { windowMs: 60_000, maxRequests: 10 }, // 10 per minute
  general: { windowMs: 60_000, maxRequests: 20 }, // 20 per minute
};
