#!/usr/bin/env node
/**
 * Capture harness for the StellarDripz product-pitch video.
 *
 * Drives the real app in headless Chromium and records the raw material the
 * video is cut from:
 *
 *   • stills — high-DPI screenshots (deviceScaleFactor 2) of real UI states,
 *              each with element bounding boxes so the video can zoom to and
 *              spotlight the exact control being talked about.
 *   • clips  — short frame sequences with wall-clock timestamps, used where
 *              something genuinely moves (cooldown countdown, live events).
 *
 * Nothing is mocked except the wallet extension itself (see
 * lib/wallet-stub.mjs): reads, faucet funding, payments and contract calls all
 * hit Stellar testnet for real, signed by the throwaway keypair in
 * video/.work/demo-account.json.
 *
 *   node video/scripts/capture.mjs                 # every flow, in order
 *   node video/scripts/capture.mjs faucet payment  # selected flows
 *   node video/scripts/capture.mjs --fresh faucet  # new demo keypair first
 *   node video/scripts/capture.mjs --reset home    # drop stale manifest data
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { walletStubSource } from "./lib/wallet-stub.mjs";

const require = createRequire(import.meta.url);

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORK = path.join(ROOT, "video", ".work");
const STILLS = path.join(WORK, "stills");
const CLIPS = path.join(WORK, "clips");
const MANIFEST = path.join(WORK, "manifest.json");
const QA_REPORT = path.join(WORK, "qa.md");

const BASE_URL = process.env.CAPTURE_BASE_URL || "http://localhost:3210";
const LIVE_URL = process.env.CAPTURE_LIVE_URL || "https://stellardripz.vercel.app";
const DSF = Number(process.env.CAPTURE_DSF || 2);
const VIEWPORT = { width: 1600, height: 900 };
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/** Contract IDs deployed to testnet (mirrors README + .env.local). */
const CONTRACTS = {
  counter: "CCAIIGMOBRZ2P6OHSYABBB35TJDSXBTC2T5IX7KVPXNIQKXGDJ46R2AE",
  token: "CD3YTU3JCBEMNNVISPTLPVYQATDGIRBJPLVJ2MIO3W56O7TYSWDG3GY6",
  pool: "CCBNJTZ22HDJTQHIINS22FNIK5KRYIW3CPORFAKNCBMWWL7SRJMZIR6X",
  governance: "CD3NIJCGVECTGPOUQOWYERWXQMOXJFSX6AKVI4KZVXGO4ZBYO7G6AIVH",
  badge: "CAZFH3S7JUEI7LZSQGHMM6OF5UKWLNZ3CSOX2KNUX3RBFPP5Q6GEEUWE",
};

// ---- demo identities -------------------------------------------------------

let _sdk = null;
function sdk() {
  if (!_sdk) _sdk = require("@stellar/stellar-sdk");
  return _sdk;
}

function keypairRecord(name, { fresh = false } = {}) {
  const file = path.join(WORK, `${name}.json`);
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const kp = sdk().Keypair.random();
  const record = {
    publicKey: kp.publicKey(),
    secret: kp.secret(),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

// ---- manifest --------------------------------------------------------------

function loadManifest() {
  if (existsSync(MANIFEST)) return JSON.parse(readFileSync(MANIFEST, "utf8"));
  return { meta: {}, stills: {}, clips: {} };
}

const manifest = loadManifest();

function rel(file) {
  return path.relative(WORK, file).split(path.sep).join("/");
}

/**
 * Text digest of what is actually on screen. The harness runs headless and
 * unattended, so this is how a broken capture (error overlay, failed API call,
 * wrong scroll position) gets caught without a human eye.
 */
async function screenDigest(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.opacity !== "0"
      );
    };
    const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
    return {
      scrollY: Math.round(window.scrollY),
      devOverlay: !!document.querySelector("nextjs-portal"),
      headings: [...document.querySelectorAll("h1,h2,h3")].filter(visible).map(text).slice(0, 14),
      buttons: [...document.querySelectorAll("button")]
        .filter(visible)
        .map(text)
        .filter(Boolean)
        .slice(0, 24),
      alerts: [...document.querySelectorAll('[role="alert"], [role="status"]')]
        .filter(visible)
        .map(text)
        .slice(0, 6),
      toasts: [...document.querySelectorAll("div.max-w-sm.rounded-xl")]
        .filter(visible)
        .map(text)
        .slice(0, 4),
      monospace: [...document.querySelectorAll(".font-mono")]
        .filter(visible)
        .map(text)
        .filter((t) => t.length > 6)
        .slice(0, 10),
      errorish: [...document.querySelectorAll("body *")]
        .filter(
          (el) =>
            visible(el) &&
            el.children.length === 0 &&
            /fail|error|unavailable|not found|rejected|timed out/i.test(text(el)),
        )
        .map(text)
        .slice(0, 6),
    };
  });
}

// ---- capture session -------------------------------------------------------

class Capture {
  constructor(page, account) {
    this.page = page;
    this.account = account;
    this.apiErrors = [];
    // Surface failed API calls (status + body) — an unattended run otherwise
    // only shows the UI's generic "Failed" toast, which says nothing about why.
    page.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("/api/") || response.status() < 400) return;
      let body = "";
      try {
        body = (await response.text()).slice(0, 400);
      } catch {
        /* body unavailable */
      }
      const entry = `${response.status()} ${url.replace(BASE_URL, "")} — ${body}`;
      this.apiErrors.push(entry);
      console.log(`    ⚠ api ${entry}`);
    });
  }

  async settle(ms = 900) {
    await this.page.waitForTimeout(ms);
  }

  /**
   * Screenshot the current viewport at deviceScaleFactor 2.
   * `marks` maps a friendly name to a selector; the resolved boxes are stored
   * in the manifest so scenes can zoom/spotlight without duplicating selectors.
   */
  async shot(name, { marks = {}, scroll = null, settle = 300 } = {}) {
    const { page } = this;
    if (scroll) {
      await page
        .locator(scroll)
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await page.waitForTimeout(350);
    }
    const resolved = {};
    for (const [key, selector] of Object.entries(marks)) {
      const box = await page
        .locator(selector)
        .first()
        .boundingBox()
        .catch(() => null);
      if (box) resolved[key] = box;
      else console.warn(`      ⚠ mark "${key}" (${selector}) not found for ${name}`);
    }
    const digest = await screenDigest(page);
    if (settle) await page.waitForTimeout(settle);
    const file = path.join(STILLS, `${name}.png`);
    await page.screenshot({ path: file });
    manifest.stills[name] = {
      file: rel(file),
      viewport: VIEWPORT,
      dsf: DSF,
      scrollY: digest.scrollY,
      marks: resolved,
      digest,
      at: Date.now(),
    };
    const flags = [
      digest.devOverlay && "DEV-OVERLAY",
      digest.errorish.length && `errors: ${digest.errorish.join(" | ")}`,
      !Object.keys(resolved).length === false &&
        Object.keys(marks).filter((k) => !resolved[k]).length &&
        `missing marks: ${Object.keys(marks).filter((k) => !resolved[k]).join(",")}`,
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`    ✓ still ${name}${flags ? `  ⚠ ${flags}` : ""}`);
    return file;
  }

  /**
   * Record a short frame sequence. Each step may run an action, then holds for
   * N seconds while frames are grabbed with real wall-clock timestamps.
   */
  async clip(name, steps, { fps = 12 } = {}) {
    const { page } = this;
    const dir = path.join(CLIPS, name);
    mkdirSync(dir, { recursive: true });
    const frames = [];
    const t0 = Date.now();
    for (const step of steps) {
      if (step.action) await step.action();
      const deadline = Date.now() + (step.hold ?? 0) * 1000;
      for (;;) {
        const t = (Date.now() - t0) / 1000;
        const file = path.join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
        await page.screenshot({ path: file, type: "jpeg", quality: 90 });
        frames.push({ file: rel(file), t });
        if (Date.now() >= deadline) break;
        await page.waitForTimeout(Math.max(0, Math.round(1000 / fps) - 70));
      }
    }
    const duration = frames.length ? frames[frames.length - 1].t + 1 / fps : 0;
    manifest.clips[name] = { dir: rel(dir), fps, duration, frames, at: Date.now() };
    console.log(`    ✓ clip ${name} (${frames.length} frames · ${duration.toFixed(1)}s)`);
  }

  /**
   * Sign an XDR envelope with the demo keypair (called from the page stub).
   *
   * This mirrors what a real Soroban wallet does: for an invocation that
   * requires authorization, the entry has to be simulated, signed
   * (`authorizeEntry`) and attached to the operation before the envelope is
   * signed — envelope-signing alone fails on-chain with txBadAuth.
   */
  async signXdr(xdr) {
    const S = sdk();
    const keypair = S.Keypair.fromSecret(this.account.secret);
    const tx = S.TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);

    // The server prepares Soroban invocations (simulate → assemble) before
    // handing them to the wallet, so the envelope already carries its
    // footprint/auth. Auth entries that need an explicit signature (address
    // credentials) are signed here — exactly what a real wallet does — and
    // source-account credentials need nothing beyond the envelope signature.
    const invokeOps = tx.operations.filter((op) => op.type === "invokeHostFunction");
    const addressEntries = invokeOps
      .flatMap((op) => op.auth ?? [])
      .filter((entry) => entry.credentials().switch().name === "sorobanCredentialsAddress");

    if (addressEntries.length > 0) {
      const server = new S.rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
      );
      const { sequence } = await server.getLatestLedger();
      for (const op of invokeOps) {
        if (!op.auth?.length) continue;
        op.auth = await Promise.all(
          op.auth.map(async (entry) => {
            try {
              return await S.authorizeEntry(entry, keypair, sequence + 120, NETWORK_PASSPHRASE);
            } catch {
              // Entry for another signer — leave it untouched.
              return entry;
            }
          }),
        );
      }
    }

    tx.sign(keypair);
    return tx.toEnvelope().toXDR("base64");
  }
}

// ---- flows -----------------------------------------------------------------

const flows = {};

/**
 * Capture order. It deliberately differs from the narration order: the faucet
 * runs first so the same wallet is funded before the dashboard beauty shots
 * (scene 2) are taken, which keeps one address consistent across the video.
 */
const FLOW_ORDER = ["home", "faucet", "connect", "payment", "contracts", "admin", "mobile", "live"];

/**
 * Make sure the payment recipient exists on-chain. A Stellar `payment`
 * operation is rejected with op_no_destination for an unfunded account, so the
 * demo recipient is created through Friendbot before the capture (a real
 * testnet action, just not part of the filmed flow).
 */
async function ensureRecipientFunded(publicKey) {
  try {
    const existing = await fetch(`https://horizon-testnet.stellar.org/accounts/${publicKey}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (existing.ok) return;
  } catch {
    /* fall through to funding */
  }
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`, {
    signal: AbortSignal.timeout(40_000),
  });
  console.log(`    · recipient funded via Friendbot (${res.status})`);
  await new Promise((r) => setTimeout(r, 4000));
}

/**
 * Toast cards. The app's toast markup has no ARIA role, so text matching via
 * the card's own classes is the only stable handle on it.
 */
function toastCards(page) {
  return page.locator("div.max-w-sm.rounded-xl");
}

/**
 * Locator that only exists on the connected dashboard: the wallet card's
 * Disconnect button. Plain text matching is unusable here because "Testnet
 * Faucet" appears in both the header subtitle and the faucet card.
 */
function connectedMarker(page) {
  return page.getByRole("button", { name: "Disconnect" });
}

/**
 * Make sure the wallet is connected for flows that need the dashboard.
 * Each flow may be run standalone, so this reconnects when needed instead of
 * assuming an earlier flow already did it.
 */
async function ensureConnected(c) {
  const { page } = c;
  if (await connectedMarker(page).isVisible().catch(() => false)) return;
  await page.goto(BASE_URL, { waitUntil: "load" });
  await c.settle(1500);
  await page.getByRole("button", { name: /connect/i }).first().click();
  await page.getByText("Choose Wallet").waitFor({ timeout: 15_000 });
  await c.settle(400);
  await page.getByText("Freighter", { exact: true }).first().click();
  await connectedMarker(page).waitFor({ timeout: 25_000 });
  await c.settle(1200);
}

/** Disconnected landing page + multi-wallet picker. */
flows.home = async (c) => {
  const { page } = c;
  await page.goto(BASE_URL, { waitUntil: "load" });
  await c.settle(1800);
  await c.shot("home-hero", {
    marks: {
      heroTitle: "h2",
      heroTagline: "h2 + p",
      networkBadge: '[role="status"]',
      walletPanel: "text=Connect Wallet",
    },
  });

  await page.getByRole("button", { name: /connect/i }).first().click();
  await page.getByText("Choose Wallet").waitFor({ timeout: 15_000 });
  await c.settle(800);
  await c.shot("wallet-picker", {
    scroll: null,
    marks: {
      picker: "text=Choose Wallet",
      freighter: "text=Freighter",
      albedo: "text=Albedo",
      xbull: "text=xBull",
      lobstr: "text=LOBSTR",
      walletconnect: "text=WalletConnect",
    },
  });
  await page.keyboard.press("Escape");
  await c.settle(500);
  await c.shot("home-cards", { marks: { grid: "text=Contracts" } });
};

/** Connect Freighter (test double) and land on the funded dashboard. */
flows.connect = async (c) => {
  const { page } = c;
  await page.goto(BASE_URL, { waitUntil: "load" });
  await c.settle(1600);
  // Earlier flows in the same context leave a persisted session; disconnect it
  // so this flow films the real picker → connect transition.
  const disconnect = page.getByRole("button", { name: "Disconnect" });
  if (await disconnect.isVisible().catch(() => false)) {
    await disconnect.click();
    await c.settle(600);
  }
  await page.getByRole("button", { name: /connect/i }).first().click();
  await page.getByText("Choose Wallet").waitFor({ timeout: 15_000 });
  await c.settle(500);
  await page.getByText("Freighter", { exact: true }).first().click();
  await connectedMarker(page).waitFor({ timeout: 25_000 });
  await c.settle(1500);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await c.settle(500);
  await c.shot("dashboard-top", {
    marks: {
      walletCard: 'button:has-text("Disconnect")',
      address: 'a[title="Open address on StellarExpert"]',
      balances: "text=Balances",
    },
  });
  await c.shot("dashboard-grid", {
    scroll: 'button:has-text("Request 10,000 XLM"), text=Cooldown active',
    marks: {
      faucet: "text=Testnet Faucet",
      sendPanel: "text=Recipient Address",
      balance: "text=Balances",
    },
  });
};

/** Request 10,000 testnet XLM from the in-app faucet (real Friendbot call). */
flows.faucet = async (c) => {
  const { page } = c;
  await ensureConnected(c);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await c.settle(500);
  await c.shot("faucet-before", {
    scroll: "text=Testnet Faucet",
    marks: { faucetCard: "text=Powered by Stellar Friendbot", balance: "text=Balances" },
  });

  await page.getByRole("button", { name: /request 10,000 xlm/i }).click();
  await page.getByText(/Faucet success!/i).first().waitFor({ timeout: 60_000 });
  await c.settle(2800);
  // Scroll the faucet card itself into view: matching the "Testnet Faucet"
  // header text instead hits the (always-visible) page subtitle and leaves the
  // card — the thing being highlighted — below the fold in the still.
  await c.shot("faucet-success", {
    scroll: 'button:has-text("Request 10,000 XLM")',
    marks: {
      toast: "div.max-w-sm.rounded-xl",
      faucetCard: "text=Powered by Stellar Friendbot",
      balance: "text=Balances",
    },
  });
  await c.shot("balance-funded", {
    scroll: "text=Balances",
    marks: { balance: "text=Balances" },
  });

  // Cooldown timer counting down — genuinely time-based, so record frames.
  await c.clip("cooldown", [
    { hold: 5 },
    {
      hold: 5,
      action: async () => {
        const refresh = page.getByRole("button", { name: /^refresh$/i }).first();
        if (await refresh.isVisible().catch(() => false)) await refresh.click().catch(() => {});
      },
    },
  ]);
  await c.shot("cooldown-still", {
    scroll: "text=Cooldown:",
    marks: { timer: "text=/Cooldown: \\d/" },
  });
};

/** Send a real XLM payment to a second testnet account. */
flows.payment = async (c) => {
  const { page } = c;
  await ensureConnected(c);
  const recipient = keypairRecord("demo-recipient");
  await ensureRecipientFunded(recipient.publicKey);

  await c.shot("send-empty", {
    scroll: "text=Transfer assets to another address",
    marks: { sendPanel: "text=Transfer assets to another address" },
  });

  await page.getByPlaceholder("G...").fill(recipient.publicKey);
  await page.getByPlaceholder("0.0").fill("250");
  const memo = page.getByPlaceholder(/Invoice/i);
  if (await memo.isVisible().catch(() => false)) await memo.fill("pitch-demo-001");
  await c.settle(700);
  // Same reasoning as the faucet: anchor on the Send button so the control
  // that is about to be pressed is actually inside the captured frame.
  await c.shot("send-filled", {
    scroll: 'button:has-text("Send XLM")',
    marks: {
      sendPanel: "text=Transfer assets to another address",
      recipient: "text=Recipient Address",
      sendButton: 'button:has-text("Send XLM")',
    },
  });

  await page.locator('button:has-text("Send XLM")').first().click();
  await c.settle(400);
  await c.shot("send-submitting", {
    scroll: "text=Transfer assets to another address",
    marks: { sendButton: 'button:has-text("Sending")' },
  });
  await toastCards(page).filter({ hasText: /Payment sent|sent successfully/i }).first().waitFor({ timeout: 90_000 }).catch(() => console.warn("      ⚠ payment toast never appeared"));
  await c.settle(500);
  await c.shot("payment-success", { marks: { toast: "div.max-w-sm.rounded-xl" } });

  await c.shot("history-rows", {
    scroll: "text=Transaction History",
    marks: { history: "text=Transaction History", filter: 'button:has-text("Sends")' },
  });
};

/** Guided contract wizard + direct Soroban read/increment with live events. */
flows.contracts = async (c) => {
  const { page } = c;
  await ensureConnected(c);
  const pick = {
    mint: 'button:has-text("mint new tokens to an address")',
    custom: 'button:has-text("Any contract function")',
  };

  await c.shot("wizard-actions", {
    scroll: "text=Contract Wizard",
    marks: {
      wizard: "text=Guided mint / transfer / stake / vote flows",
      mint: pick.mint,
      transfer: 'button:has-text("transfer tokens from your wallet")',
      stake: 'button:has-text("stake tokens and start accruing")',
      vote: 'button:has-text("cast a vote on a proposal")',
      targetSelect: 'select[aria-label="Target contract"]',
      continueButton: 'button:has-text("Continue")',
    },
  });

  // Guided mint flow: fill the form, then review it.
  await page.locator(pick.mint).first().click();
  await c.settle(800);
  await page.locator('input[placeholder="G…"]').first().fill(c.account.publicKey);
  await page.locator('input[placeholder^="e.g. 10000000"]').first().fill("1000000000");
  await c.settle(600);
  await c.shot("wizard-mint-params", {
    marks: { panel: "text=Contract Wizard", amountField: "text=smallest token unit" },
  });
  await page.getByRole("button", { name: /^review$/i }).click();
  await c.settle(800);
  await c.shot("wizard-review", {
    marks: {
      panel: "text=Review & execute",
      execute: 'button:has-text("Sign & execute")',
    },
  });

  // Custom call: a real, permissionless write against the deployed Counter.
  // Review → details → action picker (the review step exposes "Edit details").
  // The target contract is chosen on the setup step, before the action, so the
  // custom ID goes in first and survives the action switch.
  await page.getByRole("button", { name: /edit details/i }).click();
  await c.settle(500);
  await page.getByRole("button", { name: /change action/i }).click();
  await c.settle(600);
  await page.locator('input[aria-label="Custom contract ID"]').fill(CONTRACTS.counter);
  await c.settle(400);
  await page.locator(pick.custom).first().click();
  await c.settle(600);
  await page.locator('input[placeholder="function_name"]').fill("increment");
  await page.locator("textarea").first().fill(`["${c.account.publicKey}"]`);
  await c.settle(500);
  await c.shot("wizard-custom", {
    marks: {
      method: 'input[placeholder="function_name"]',
      args: "textarea",
      review: 'button:has-text("Review")',
    },
  });
  await page.getByRole("button", { name: /^review$/i }).click();
  await c.settle(700);
  await page.getByRole("button", { name: /sign & execute/i }).click();
  await c.settle(900);
  await c.shot("wizard-submitting", { marks: { submit: 'button:has-text("Submitting")' } });
  // Toast copy is "Custom executed!" once the invocation is confirmed.
  await page
    .locator("div.max-w-sm.rounded-xl")
    .filter({ hasText: /executed|submitted/i })
    .first()
    .waitFor({ timeout: 120_000 })
    .catch(() => console.warn("      ⚠ wizard success toast never appeared"));
  await c.settle(400);
  await c.shot("wizard-executed", { marks: { toast: "div.max-w-sm.rounded-xl" } });

  // Direct read + increment on the Soroban demo panel.
  const contractInput = page.locator('input[placeholder="Paste deployed contract ID (C…)"]');
  if (await contractInput.isVisible().catch(() => false)) {
    await contractInput.fill(CONTRACTS.counter);
    await page.locator("button:has-text('Connect')").last().click();
    await c.settle(1800);
  }
  await page.getByText("Soroban Demo").scrollIntoViewIfNeeded().catch(() => {});
  await c.settle(800);
  await c.shot("soroban-panel", {
    marks: { panel: "text=Soroban Demo", contractLink: "text=↗" },
  });

  await page.locator('button:has-text("Read")').first().click();
  await c.settle(3500);
  await c.shot("soroban-read", {
    scroll: "text=Soroban Demo",
    marks: { counterValue: "p.text-xl", readButton: 'button:has-text("Read")' },
  });

  // Recording the write + the live event stream: the event only lands after
  // the ledger closes, so the clip runs long and the still waits for a row.
  await c.clip("events", [
    {
      hold: 3,
      action: () => page.locator('button:has-text("+1")').first().click(),
    },
    { hold: 17 },
  ]);
  await page
    .locator("li:has-text('⚡')")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => console.warn("      ⚠ no live event rendered within 30s"));
  await c.settle(600);
  await c.shot("soroban-incremented", {
    marks: { counterValue: "p.text-xl", events: "text=Live Events", eventRow: "li:has-text('⚡')" },
  });
};

/**
 * Re-shoot just the wizard action list.
 *
 * The wizard's action rows (mint / transfer / stake / vote) sit below the fold
 * when the wizard panel is framed from its heading, so the highlights for each
 * action had nothing on screen to point at. This re-frames on the last row so
 * the whole list is inside the capture.
 */
flows["wizard-shot"] = async (c) => {
  const { page } = c;
  await ensureConnected(c);
  await c.shot("wizard-actions", {
    scroll: 'button:has-text("cast a vote on a proposal")',
    marks: {
      wizard: "text=Guided mint / transfer / stake / vote flows",
      mint: 'button:has-text("mint new tokens to an address")',
      transfer: 'button:has-text("transfer tokens from your wallet")',
      stake: 'button:has-text("stake tokens and start accruing")',
      vote: 'button:has-text("cast a vote on a proposal")',
    },
  });
};

/**
 * Direct Soroban reads + a recorded counter increment with live events.
 *
 * Separate from `contracts` so it can be re-run on its own (the wizard flow
 * performs real on-chain writes and takes minutes); everything here is
 * idempotent and every step is bounded, so a slow RPC can never wedge the run.
 */
flows.soroban = async (c) => {
  const { page } = c;
  await ensureConnected(c);

  const contractInput = page.locator('input[placeholder="Paste deployed contract ID (C…)"]');
  if (await contractInput.isVisible().catch(() => false)) {
    await contractInput.fill(CONTRACTS.counter);
    await page.locator("button:has-text('Connect')").last().click();
    await c.settle(1500);
  }
  await page
    .getByText("Soroban Demo")
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await c.settle(700);
  await c.shot("soroban-panel", {
    marks: { panel: "text=Soroban Demo", contractLink: "text=↗" },
  });

  // Direct RPC read. The counter renders an em dash until a read lands, so
  // waiting on a real number is the honest success condition here.
  const read = page.locator('button:has-text("Read")').first();
  await read.scrollIntoViewIfNeeded().catch(() => {});
  await read.click({ timeout: 15_000 }).catch(() => console.warn("      ⚠ Read click failed"));
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector("p.text-xl");
        return !!el && (el.textContent || "").trim() !== "—";
      },
      null,
      { timeout: 25_000 },
    )
    .catch(() => console.warn("      ⚠ counter never returned a value"));
  await c.settle(500);
  await c.shot("soroban-read", {
    marks: { counterValue: "p.text-xl", readButton: 'button:has-text("Read")' },
  });

  // Record the write and the event that lands after the ledger closes.
  await c.clip("events", [
    { hold: 3, action: () => page.locator('button:has-text("+1")').first().click() },
    { hold: 15 },
  ]);
  await page
    .locator("li:has-text('⚡')")
    .first()
    .waitFor({ timeout: 40_000 })
    .catch(() => console.warn("      ⚠ no live event rendered in time"));
  await c.settle(500);
  await c.shot("soroban-incremented", {
    marks: {
      counterValue: "p.text-xl",
      events: "text=Live Events",
      eventRow: "li:has-text('⚡')",
    },
  });
};

/** Real admin analytics fed by the usage this capture run just generated. */
flows.admin = async (c) => {
  const { page } = c;
  await page.goto(`${BASE_URL}/admin`, { waitUntil: "load" });
  await c.settle(3000);
  await c.shot("admin-dashboard", { marks: { stats: "main", table: "table" } });
};

/** Live Vercel deployment + health endpoint (a genuine visitor, no test double). */
flows.live = async (c) => {
  const { page } = c;
  await page.goto(LIVE_URL, { waitUntil: "load" });
  await c.settle(2500);
  await c.shot("live-home", { marks: { hero: "h2", badge: '[role="status"]' } });

  await page.goto(`${LIVE_URL}/api/health`, { waitUntil: "load" });
  await c.settle(900);
  await c.shot("live-health");
};

/** Mobile viewport (ships as the README responsive screenshot). */
flows.mobile = async (c) => {
  const { page } = c;
  await page.goto(BASE_URL, { waitUntil: "load" });
  await c.settle(1600);
  await page.getByRole("button", { name: /connect/i }).first().click();
  await page.getByText("Choose Wallet").waitFor({ timeout: 15_000 });
  await c.settle(500);
  await page.getByText("Freighter", { exact: true }).first().click();
  await connectedMarker(page).waitFor({ timeout: 25_000 });
  await c.settle(1600);
  await c.shot("mobile-top", { marks: { header: "header" } });
};

// ---- runner ----------------------------------------------------------------

function writeQaReport(names) {
  const lines = [`# Capture QA — ${new Date().toISOString()}`, "", `flows: ${names.join(", ")}`, ""];
  const apiErrors = manifest.meta.apiErrors || [];
  lines.push(`## failed API calls (${apiErrors.length})`);
  lines.push(...(apiErrors.length ? apiErrors.map((e) => `- ${e}`) : ["- none"]), "");
  for (const [name, still] of Object.entries(manifest.stills)) {
    const d = still.digest || {};
    lines.push(`## still \`${name}\``);
    lines.push(
      `- file \`${still.file}\` · scrollY ${still.scrollY ?? "?"} · marks ${Object.keys(still.marks || {}).join(", ") || "—"}`,
    );
    lines.push(`- headings: ${(d.headings || []).join(" / ")}`);
    lines.push(`- buttons: ${(d.buttons || []).join(" / ")}`);
    lines.push(`- alerts: ${(d.alerts || []).join(" / ") || "—"}`);
    lines.push(`- toasts: ${(d.toasts || []).join(" / ") || "—"}`);
    lines.push(`- mono: ${(d.monospace || []).join(" / ") || "—"}`);
    lines.push(`- errorish: ${(d.errorish || []).join(" / ") || "—"}`);
    lines.push("");
  }
  for (const [name, clip] of Object.entries(manifest.clips)) {
    lines.push(`## clip \`${name}\` — ${clip.frames.length} frames · ${clip.duration.toFixed(1)}s`);
    lines.push("");
  }
  writeFileSync(QA_REPORT, lines.join("\n"));
}

/** Downscale selected 2x captures into the README's screenshots/ folder. */
function exportScreenshots() {
  const targets = [
    ["wallet-picker", "screenshots/wallet-connect.png"],
    ["soroban-read", "screenshots/soroban-demo.png"],
    ["mobile-top", "screenshots/mobile-responsive.png"],
    ["admin-dashboard", "screenshots/admin-dashboard.png"],
    ["live-home", "screenshots/live-deployment.png"],
  ];
  for (const [name, out] of targets) {
    const src = path.join(STILLS, `${name}.png`);
    if (!existsSync(src)) continue;
    const dest = path.join(ROOT, out);
    mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", "scale=1600:-2", dest]);
    console.log(`    ✓ screenshot ${out}`);
  }
}

async function isServerUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const fresh = argv.includes("--fresh");
  const reset = argv.includes("--reset");
  const selected = argv.filter((a) => !a.startsWith("--"));
  const names = selected.length ? selected : FLOW_ORDER;

  if (reset) {
    manifest.stills = {};
    manifest.clips = {};
  }
  mkdirSync(STILLS, { recursive: true });
  mkdirSync(CLIPS, { recursive: true });

  if (names.some((n) => n !== "live")) {
    if (!(await isServerUp(`${BASE_URL}/api/health`))) {
      console.error(`✗ no server at ${BASE_URL} — start it with: npx next dev -p 3210`);
      process.exit(1);
    }
  }

  const account = keypairRecord("demo-account", { fresh });
  manifest.meta = {
    app: BASE_URL,
    live: LIVE_URL,
    account: account.publicKey,
    capturedAt: new Date().toISOString(),
    flows: names,
  };
  console.log(`▶ capture: ${names.join(", ")}`);
  console.log(`  account  ${account.publicKey}`);
  console.log(`  app      ${BASE_URL}`);

  const browser = await chromium.launch({ headless: true });

  const contexts = {};
  for (const [key, options] of Object.entries({
    desktop: { viewport: VIEWPORT, deviceScaleFactor: DSF, colorScheme: "dark" },
    mobile: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      colorScheme: "dark",
    },
    live: { viewport: VIEWPORT, deviceScaleFactor: DSF, colorScheme: "dark" },
  })) {
    const context = await browser.newContext(options);
    if (key !== "live") {
      // Install the wallet test double before any app code runs.
      await context.addInitScript(
        walletStubSource({ publicKey: account.publicKey, networkPassphrase: NETWORK_PASSPHRASE }),
      );
    }
    const page = await context.newPage();
    const capture = new Capture(page, account);
    await page.exposeFunction("__signXdr", (xdr) => capture.signXdr(xdr));
    contexts[key] = capture;
  }

  try {
    for (const name of names) {
      if (!flows[name]) {
        console.warn(`  ⚠ unknown flow "${name}" — skipping`);
        continue;
      }
      console.log(`▶ flow ${name}`);
      await flows[name](contexts[name] ?? contexts.desktop);
    }
  } finally {
    const apiErrors = Object.values(contexts).flatMap((c) => c.apiErrors);
    manifest.meta.apiErrors = apiErrors;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    writeQaReport(names);
    exportScreenshots();
    await browser.close();
  }

  console.log(`\n✓ capture complete → ${rel(MANIFEST)}`);
  console.log(
    `  ${Object.keys(manifest.stills).length} stills · ${Object.keys(manifest.clips).length} clips`,
  );
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}`);
  process.exit(1);
});
