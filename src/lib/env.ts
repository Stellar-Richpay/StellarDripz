/**
 * Environment validation & configuration.
 * Validates required env vars at startup and provides typed config access.
 */
import { setLogLevel } from "@/lib/logger";

export interface AppConfig {
  nodeEnv: "development" | "production" | "test";
  isTestnet: boolean;
  sorobanRpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  friendbotUrl: string;
  stellarExpertUrl: string;
  contractExplorerUrl: string;
  contractIdCounter: string | null;
  contractIdDripToken: string | null;
  contractIdDripPool: string | null;
  contractIdGovernance: string | null;
  contractIdBadge: string | null;
  rateLimitFaucet: number;
  rateLimitContract: number;
  rateLimitGeneral: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

function required(name: string, value: string | undefined, fallback?: string): string {
  if (value && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

function optional(name: string, value: string | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Parse a positive-integer env var with a fallback. A bare parseInt can
 * return NaN (e.g. RATE_LIMIT_FAUCET_MS=abc), and a NaN window would
 * silently disable rate limiting — worse than falling back to the default.
 */
function positiveInt(value: string | undefined, fallback: number): number {
  if (!value || !value.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Resolve the LOG_LEVEL env var. Unlike a bare cast, an unrecognized value
 * (e.g. LOG_LEVEL=verbose) falls back to the environment default instead of
 * being accepted — a bad level would otherwise make shouldLog() compare
 * undefined and silently suppress every log line.
 */
function resolveLogLevel(nodeEnv: AppConfig["nodeEnv"]): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (raw && (LOG_LEVELS as readonly string[]).includes(raw.trim())) {
    return raw.trim() as LogLevel;
  }
  return nodeEnv === "production" ? "info" : "debug";
}

let _config: AppConfig | null = null;

export function getAppConfig(): AppConfig {
  if (_config) return _config;

  const nodeEnv = (process.env.NODE_ENV || "development") as AppConfig["nodeEnv"];

  const isTestnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet";

  _config = {
    nodeEnv,
    isTestnet,

    sorobanRpcUrl: required(
      "NEXT_PUBLIC_SOROBAN_RPC_URL",
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
      "https://soroban-testnet.stellar.org",
    ),
    horizonUrl: required(
      "NEXT_PUBLIC_HORIZON_URL",
      process.env.NEXT_PUBLIC_HORIZON_URL,
      "https://horizon-testnet.stellar.org",
    ),
    networkPassphrase: required(
      "NEXT_PUBLIC_NETWORK_PASSPHRASE",
      process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
      "Test SDF Network ; September 2015",
    ),
    friendbotUrl: required(
      "NEXT_PUBLIC_FRIENDBOT_URL",
      process.env.NEXT_PUBLIC_FRIENDBOT_URL,
      "https://friendbot.stellar.org",
    ),
    stellarExpertUrl: required(
      "NEXT_PUBLIC_STELLAR_EXPERT_URL",
      process.env.NEXT_PUBLIC_STELLAR_EXPERT_URL,
      "https://stellar.expert/explorer/testnet",
    ),

    contractExplorerUrl: required(
      "NEXT_PUBLIC_CONTRACT_EXPLORER_URL",
      process.env.NEXT_PUBLIC_CONTRACT_EXPLORER_URL,
      "https://stellar.expert/explorer/testnet/contract",
    ),
    contractIdCounter: optional(
      "NEXT_PUBLIC_CONTRACT_COUNTER",
      process.env.NEXT_PUBLIC_CONTRACT_COUNTER,
    ),
    contractIdDripToken: optional(
      "NEXT_PUBLIC_CONTRACT_DRIP_TOKEN",
      process.env.NEXT_PUBLIC_CONTRACT_DRIP_TOKEN,
    ),
    contractIdDripPool: optional(
      "NEXT_PUBLIC_CONTRACT_DRIP_POOL",
      process.env.NEXT_PUBLIC_CONTRACT_DRIP_POOL,
    ),
    contractIdGovernance: optional(
      "NEXT_PUBLIC_CONTRACT_GOVERNANCE",
      process.env.NEXT_PUBLIC_CONTRACT_GOVERNANCE,
    ),
    contractIdBadge: optional("NEXT_PUBLIC_CONTRACT_BADGE", process.env.NEXT_PUBLIC_CONTRACT_BADGE),

    rateLimitFaucet: positiveInt(process.env.RATE_LIMIT_FAUCET_MS, 60000),
    rateLimitContract: positiveInt(process.env.RATE_LIMIT_CONTRACT_MS, 30000),
    rateLimitGeneral: positiveInt(process.env.RATE_LIMIT_GENERAL_MS, 10000),

    logLevel: resolveLogLevel(nodeEnv),
  };

  // LOG_LEVEL was previously read into the config but never applied, leaving
  // the logger pinned at its own hard-coded default. Apply it now so the env
  // var actually controls server log verbosity.
  setLogLevel(_config.logLevel);

  // Log config on startup (server-side only, only in dev)
  if (typeof window === "undefined" && _config.nodeEnv === "development") {
    console.log("[StellarDripz] Config loaded (dev only):", {
      nodeEnv: _config.nodeEnv,
      isTestnet: _config.isTestnet,
      logLevel: _config.logLevel,
      contractsConfigured: [
        _config.contractIdCounter,
        _config.contractIdDripToken,
        _config.contractIdDripPool,
        _config.contractIdGovernance,
        _config.contractIdBadge,
      ].filter(Boolean).length,
    });
  }

  return _config;
}

/** Validate critical env vars — call at startup */
export function validateEnv(): { valid: boolean; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const config = getAppConfig();
    if (config.nodeEnv === "production" && config.isTestnet) {
      warnings.push("Running in production mode on Testnet — is this intentional?");
    }
    if (!config.contractIdCounter && !config.contractIdDripToken && !config.contractIdDripPool) {
      warnings.push("No contract IDs configured — smart contract features will be limited");
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Config validation failed");
  }

  return { valid: errors.length === 0, warnings, errors };
}
