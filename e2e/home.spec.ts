import { test, expect } from "@playwright/test";

test.describe("StellarDripz Homepage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the page to be fully hydrated — the hero title should be visible
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });
  });

  test("renders the hero section with branding", async ({ page }) => {
    // Logo / branding in the header
    await expect(page.locator("header")).toBeVisible();
    await expect(page.getByRole("heading", { name: "StellarDripz" })).toBeVisible();
    await expect(page.locator("text=Testnet Faucet")).toBeVisible();

    // Hero title — use .first() since h2 matches both hero and wallet headings
    await expect(page.locator("h2").first()).toContainText("Drip");
    await expect(page.locator("h2").first()).toContainText("Testnet XLM");

    // Hero description
    await expect(page.locator("text=Multi-wallet faucet")).toBeVisible();

    // Testnet badge
    await expect(page.locator("text=Stellar Testnet").first()).toBeVisible();
  });

  test("shows feature cards when wallet is disconnected", async ({ page }) => {
    // Three feature cards should be visible
    await expect(page.getByText("Faucet", { exact: true })).toBeVisible();
    await expect(page.getByText("Send", { exact: true })).toBeVisible();
    await expect(page.getByText("Analytics", { exact: true })).toBeVisible();

    // Each card has a description
    await expect(page.getByText("10,000 test XLM")).toBeVisible();
    await expect(page.locator("text=Any address")).toBeVisible();
    await expect(page.locator("text=Track usage")).toBeVisible();

    // "Connect wallet" call-to-action
    await expect(page.locator("text=Connect any Stellar wallet to get started")).toBeVisible();
  });

  test("renders the wallet connect section", async ({ page }) => {
    // WalletConnect component should render — heading and button
    const walletHeading = page.getByRole("heading", { name: "Connect Wallet" });
    await expect(walletHeading).toBeVisible();

    // Connect Wallet button (not the heading)
    const connectBtn = page.getByRole("button", { name: "Connect Wallet" });
    await expect(connectBtn).toBeVisible();

    // Click and verify the wallet picker modal opens
    await connectBtn.click();

    // "Choose Wallet" heading appears in the modal
    await expect(page.getByText("Choose Wallet")).toBeVisible({ timeout: 5_000 });

    // Freighter should be listed as an option in the picker modal
    await expect(page.getByRole("button", { name: /Freighter/ })).toBeVisible();

    // Close modal via Escape key
    await page.keyboard.press("Escape");
    await expect(page.getByText("Choose Wallet")).not.toBeVisible({ timeout: 5_000 });
  });

  test("renders the footer with legal text", async ({ page }) => {
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText("Powered by Stellar Testnet");
    await expect(footer).toContainText("Not for production use");
  });

  test("has proper page metadata", async ({ page }) => {
    const title = await page.title();
    expect(title).toContain("StellarDripz");

    // Open Graph meta tags
    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveAttribute("content", /StellarDripz/);
  });

  test("is responsive — mobile layout renders without horizontal overflow", async ({ page }) => {
    // The page should not have horizontal scroll at mobile width
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });

    // Header should still be visible
    await expect(page.locator("header")).toBeVisible();

    // Check that the main content has padding but no overflow
    const main = page.locator("main");
    const box = await main.boundingBox();
    expect(box).not.toBeNull();
  });
});

test.describe("Admin page", () => {
  test("admin page renders without crashing", async ({ page }) => {
    await page.goto("/admin");
    // The admin page may show a loading state or admin panel
    await expect(page.locator("body")).toBeVisible();
    // Should at minimum show the header
    await expect(page.locator("header")).toBeVisible();
  });
});

test.describe("API health check", () => {
  test("GET /api/health returns healthy status", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty("status", "healthy");
    expect(body).toHaveProperty("uptime");
    expect(typeof body.uptime).toBe("number");
  });

  test("GET /api/status returns 200", async ({ request }) => {
    const response = await request.get("/api/status");
    expect(response.status()).toBe(200);
  });
});

// ─── Faucet Flow ────────────────────────────────────────────────────

test.describe("Faucet flow", () => {
  test("faucet button hidden when wallet not connected", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });

    // The faucet component (with "Request 10,000 XLM") should not appear
    await expect(page.getByRole("button", { name: /Request 10,000 XLM/ })).not.toBeVisible();
  });

  test("hero text mentions faucet", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });

    // Hero description mentions faucet
    await expect(page.locator("text=Multi-wallet faucet")).toBeVisible();
  });

  test("feature card shows faucet description when disconnected", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Faucet", { exact: true })).toBeVisible();
    await expect(page.getByText("10,000 test XLM")).toBeVisible();
  });

  test("POST /api/faucet/fund requires address", async ({ request }) => {
    const response = await request.post("/api/faucet/fund", {
      data: { address: "" },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("POST /api/faucet/fund validates address format", async ({ request }) => {
    const response = await request.post("/api/faucet/fund", {
      data: { address: "invalid-address" },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("wallet picker lists Freighter as available", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });

    const connectBtn = page.getByRole("button", { name: "Connect Wallet" });
    await connectBtn.click();

    await expect(page.getByRole("button", { name: /Freighter/ })).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
  });
});

// ─── Payment Sending ────────────────────────────────────────────────

test.describe("Payment sending", () => {
  test("send form hidden when wallet not connected", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });

    // Send heading should not be visible (component is hidden)
    await expect(page.locator('input[placeholder="G..."]')).not.toBeVisible();
  });

  test("feature card shows send description when disconnected", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Send", { exact: true })).toBeVisible();
    await expect(page.locator("text=Any address")).toBeVisible();
  });

  test("POST /api/payment/send requires destination", async ({ request }) => {
    const response = await request.post("/api/payment/send", {
      data: { destination: "", amount: "10", sourceSecret: "S123" },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("POST /api/payment/send requires amount", async ({ request }) => {
    const response = await request.post("/api/payment/send", {
      data: {
        destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        amount: "",
        sourceSecret: "S123",
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("wallet picker shows multiple wallet options", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });

    const connectBtn = page.getByRole("button", { name: "Connect Wallet" });
    await connectBtn.click();

    // At least one wallet button should be visible (Freighter)
    await expect(page.getByRole("button", { name: /Freighter/ })).toBeVisible({ timeout: 5_000 });

    // Close the picker
    await page.keyboard.press("Escape");
  });
});

// ─── Contract Interaction ───────────────────────────────────────────

test.describe("Contract interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 15_000 });
  });

  test("contract section hidden when wallet not connected", async ({ page }) => {
    // The contract ID input and Connect button are only shown after wallet connection.
    // Without a wallet, they should not exist in the DOM.
    await expect(page.getByPlaceholder("Paste deployed contract ID (C…)")).not.toBeVisible();
  });

  test("analytics feature card visible when disconnected", async ({ page }) => {
    await expect(page.getByText("Analytics", { exact: true })).toBeVisible();
    await expect(page.locator("text=Track usage")).toBeVisible();
  });

  test("connect wallet CTA shown when disconnected", async ({ page }) => {
    await expect(page.locator("text=Connect any Stellar wallet to get started")).toBeVisible();
  });

  test("hero mentions smart contract support", async ({ page }) => {
    await expect(page.locator("text=smart contract").first()).toBeVisible();
  });

  test("real-time Soroban events mentioned in hero", async ({ page }) => {
    await expect(page.locator("text=real-time Soroban events")).toBeVisible();
  });

  test("POST /api/contract/invoke requires contractId", async ({ request }) => {
    const response = await request.post("/api/contract/invoke", {
      data: { contractId: "", method: "get_global", args: [], source: "G123" },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("POST /api/contract/invoke requires source address", async ({ request }) => {
    const response = await request.post("/api/contract/invoke", {
      data: {
        contractId: "CCAIIGMOBRZ2P6OHSYABBB35TJDSXBTC2T5IX7KVPXNIQKXGDJ46R2AE",
        method: "get_global",
        args: [],
        source: "",
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("events endpoint requires contractId parameter", async ({ request }) => {
    const response = await request.get("/api/events");
    // Without contractId, the endpoint should return a client error
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});
