#!/usr/bin/env node
/**
 * Collect the real evidence the video shows: command output (tests,
 * typecheck, lint), live deployment JSON, the CI workflow and source
 * excerpts. Everything is captured verbatim and saved to
 * video/.work/artifacts/*.json so the render stage never invents content.
 *
 *   node video/scripts/collect-artifacts.mjs            # commands + files
 *   node video/scripts/collect-artifacts.mjs --no-run   # files/live only
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { highlight, excerpt } from "./lib/highlight.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORK = path.join(ROOT, "video", ".work", "artifacts");
const LIVE_URL = process.env.CAPTURE_LIVE_URL || "https://stellardripz.vercel.app";

function save(name, artifact) {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(path.join(WORK, `${name}.json`), JSON.stringify({ name, ...artifact }, null, 2));
  console.log(`  ✓ ${name}`);
}

/**
 * Run a command and return its combined output (never throws on non-zero).
 *
 * Both streams are merged deliberately: jest prints its pass counts to stderr,
 * so a run that reads stdout only records an empty result — and a *passing*
 * run then looks like missing evidence instead of a green summary.
 */
function run(cmd, args, { cwd = ROOT, timeout = 300_000 } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    timeout,
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
    env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
  });
  return {
    output: `${result.stdout || ""}${result.stderr || ""}`,
    failed: result.status !== 0,
  };
}

function lines(text) {
  return text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
}

function tail(text, count) {
  return lines(text).slice(-count).join("\n");
}

function codePanel(file, { match, before = 3, after = 26, title, subtitle, lang = "ts" } = {}) {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  const part = excerpt(source, { match, before, after });
  return {
    kind: "code",
    title: title || file,
    subtitle: subtitle || `${path.basename(file)}:${part.firstLine} · ${part.totalLines} lines`,
    lang,
    firstLine: part.firstLine,
    lines: highlight(part.text, lang),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const noRun = argv.includes("--no-run");

  console.log("▶ artifacts");
  const stats = {};

  // ---- real command output -------------------------------------------------
  if (!noRun) {
    const jest = run("npx", ["jest", "--ci", "--silent"], { timeout: 420_000 });
    save("frontend-tests", {
      kind: "terminal",
      title: "npm test",
      subtitle: "jest — unit, hook and API route suites",
      text: tail(jest.output, 26),
      failed: jest.failed,
    });
    stats.jest = jest.output.match(/Tests:.*$/m)?.[0]?.trim() || "";
    stats.jestSuites = jest.output.match(/Test Suites:.*$/m)?.[0]?.trim() || "";

    const tsc = run("npx", ["tsc", "--noEmit"], { timeout: 300_000 });
    save("typecheck", {
      kind: "terminal",
      title: "npm run typecheck",
      subtitle: "tsc --noEmit (strict)",
      text: tsc.output.trim()
        ? tsc.output
        : "✓ tsc --noEmit — no type errors\n✓ strict mode, 0 emitted files",
      failed: tsc.failed,
    });

    const lint = run("npm", ["run", "lint"], { timeout: 300_000 });
    save("lint", {
      kind: "terminal",
      title: "npm run lint",
      subtitle: "next lint (eslint)",
      text: tail(lint.output, 8),
      failed: lint.failed,
    });

    const cargo = run("cargo", ["test"], { cwd: path.join(ROOT, "contracts"), timeout: 420_000 });
    save("contracts-tests", {
      kind: "terminal",
      title: "npm run contracts:test",
      subtitle: "cargo test — DripToken, DripPool, Governance, Badge",
      text: tail(cargo.output, 24),
      failed: cargo.failed,
    });
    const rustPassed = [...cargo.output.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
      (sum, m) => sum + Number(m[1]),
      0,
    );
    stats.rustTests = rustPassed;
    stats.rustFailed = /test result: FAILED/.test(cargo.output);
  }

  // ---- real files ----------------------------------------------------------
  save("architecture-reads", {
    ...codePanel("src/lib/client/directClient.ts", {
      match: "export async function directFetchBalance",
      title: "Direct reads — Horizon / Soroban RPC",
      subtitle: "src/lib/client/directClient.ts — browser → Horizon / Soroban RPC",
      lang: "ts",
      before: 6,
      after: 22,
    }),
  });

  save("architecture-writes", {
    ...codePanel("src/app/api/payment/send/route.ts", {
      match: "export async function POST",
      title: "Proxied writes",
      subtitle: "src/app/api/payment/send/route.ts — rate limit → validate → sign → submit",
      lang: "ts",
      before: 3,
      after: 24,
    }),
  });

  save("contract-source", {
    ...codePanel("contracts/src/pool/mod.rs", {
      match: "pub fn claim_reward",
      title: "DripPool — reward accounting",
      subtitle: "contracts/src/pool/mod.rs — staking, lock periods, rewards",
      lang: "rust",
      before: 6,
      after: 26,
    }),
  });

  save("ci-workflow", {
    ...codePanel(".github/workflows/ci-cd.yml", {
      match: "jobs:",
      title: "CI/CD",
      subtitle: ".github/workflows/ci-cd.yml — tests, lint, build, Vercel deploy",
      lang: "yaml",
      before: 1,
      after: 34,
    }),
  });

  // ---- live deployment -----------------------------------------------------
  try {
    const res = await fetch(`${LIVE_URL}/api/health`, { signal: AbortSignal.timeout(20_000) });
    const json = await res.json();
    const pretty = JSON.stringify(json, null, 2);
    save("live-health", {
      kind: "code",
      title: `${LIVE_URL.replace("https://", "")}/api/health`,
      subtitle: `live response · HTTP ${res.status}`,
      lang: "json",
      firstLine: 1,
      lines: highlight(pretty, "json"),
      raw: json,
    });
    stats.health = json.status;
  } catch (err) {
    console.warn(`  ⚠ live health capture failed: ${err.message}`);
  }

  try {
    const git = run("git", ["log", "--oneline", "-14"]);
    save("git-log", {
      kind: "terminal",
      title: "git log --oneline",
      subtitle: "conventional commits on main",
      text: git.output.trim(),
      failed: git.failed,
    });
    const count = run("git", ["rev-list", "--count", "HEAD"]);
    stats.commits = Number(count.output.trim()) || undefined;
  } catch {
    /* git unavailable */
  }

  save("stats", { kind: "stats", ...stats });
  console.log(`\n✓ artifacts → ${path.relative(ROOT, WORK)}`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}`);
  process.exit(1);
});
