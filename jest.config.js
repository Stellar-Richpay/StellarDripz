/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  coverageProvider: "v8",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.[tj]sx?$": ["ts-jest", { tsconfig: "tsconfig.json", allowJs: true }],
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  transformIgnorePatterns: [
    "/node_modules/(?!@(stellar|noble|walletconnect)|uint8array|feaxios|eventsource|smol-toml|multiformats|@lit|idb-keyval|@stablelib|uint8arrays)",
  ],
  // Keep these in sync with .github/workflows/ci-cd.yml — CI passes inline
  // thresholds of 45/50/55/55 to `jest --coverage`. Local runs must enforce
  // the same gate or `jest --coverage` fails locally while CI stays green
  // (the wallet adapters are browser-extension code that jsdom can't reach,
  // which is what keeps function coverage below the stricter values).
  coverageThreshold: {
    global: {
      branches: 45,
      functions: 50,
      lines: 55,
      statements: 55,
    },
  },
};

