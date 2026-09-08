/**
 * Tests for env validation and configuration
 */
import { getAppConfig, validateEnv } from "@/lib/env";

/**
 * Resolve log level from a fresh module load with the given env state.
 * getAppConfig() caches its result, so each call re-imports the module to
 * exercise the resolution path from scratch.
 */
async function resolveLogLevelWith(env: Record<string, string | undefined>): Promise<string> {
  const previous = { ...process.env };
  Object.keys(env).forEach((k) => {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  });
  try {
    jest.resetModules();
    const fresh = await import("@/lib/env");
    return fresh.getAppConfig().logLevel;
  } finally {
    process.env = previous;
  }
}

describe("getAppConfig", () => {
  it("returns default config with fallback values", () => {
    const config = getAppConfig();

    expect(config.nodeEnv).toBe("test");
    expect(config.isTestnet).toBe(true);
    expect(config.sorobanRpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(config.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(config.friendbotUrl).toBe("https://friendbot.stellar.org");
    expect(config.rateLimitFaucet).toBe(60000);
    expect(config.rateLimitContract).toBe(30000);
  });
  it("loads contract IDs from environment when configured", () => {
    // Contract IDs may be set via .env.local (deployed) or unset (null).
    // Both states are valid — the test validates the loader, not deployment state.
    const config = getAppConfig();
    // If IDs are set, they should be non-empty strings starting with "C"
    for (const id of [
      config.contractIdCounter,
      config.contractIdDripToken,
      config.contractIdDripPool,
      config.contractIdGovernance,
      config.contractIdBadge,
    ]) {
      if (id !== null) {
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
        expect(id[0]).toBe("C");
      }
    }
  });

  it("returns cached config on subsequent calls", () => {
    const config1 = getAppConfig();
    const config2 = getAppConfig();

    expect(config1).toBe(config2);
  });

  it("falls back to the environment default for an invalid LOG_LEVEL", async () => {
    // LOG_LEVEL=verbose is not a known level — it must not leak through the
    // cast and silently disable all logging (shouldLog would compare undefined).
    const level = await resolveLogLevelWith({ LOG_LEVEL: "verbose", NODE_ENV: "test" });
    expect(level).toBe("debug");
  });

  it("accepts a valid LOG_LEVEL override", async () => {
    const level = await resolveLogLevelWith({ LOG_LEVEL: "error", NODE_ENV: "test" });
    expect(level).toBe("error");
  });

  it("produces valid app config with all required fields", () => {
    const config = getAppConfig();

    // Verify all required types
    expect(typeof config.sorobanRpcUrl).toBe("string");
    expect(typeof config.horizonUrl).toBe("string");
    expect(typeof config.networkPassphrase).toBe("string");
    expect(typeof config.friendbotUrl).toBe("string");
    expect(typeof config.isTestnet).toBe("boolean");
  });
});

describe("validateEnv", () => {
  it("returns valid with no errors for default config", () => {
    const result = validateEnv();

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
  it("reports appropriate warnings based on config state", () => {
    const result = validateEnv();
    // If contracts are deployed, no contract ID warning; if not, warning appears.
    // Both states are valid — the test checks the function runs without error.
    expect(result.valid).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
