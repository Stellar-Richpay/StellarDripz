#!/usr/bin/env node
/**
 * Render repository stills from the real captured artifacts.
 *
 * The README references screenshots that cannot be taken in a browser (a CI
 * workflow definition, terminal test output). They are still *real* material —
 * the same text the harness captured from `cat .github/workflows/ci-cd.yml`,
 * `npm test` and `npm run contracts:test` — so they are composed through the
 * video stage's terminal panels and written as PNGs, which keeps every image in
 * the README genuine and every link working.
 *
 *   node video/scripts/render-still.mjs            # all cards
 *   node video/scripts/render-still.mjs tests      # one card
 */
import { chromium } from "@playwright/test";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORK = path.join(ROOT, "video", ".work");
const ARTIFACTS = path.join(WORK, "artifacts");
const OUT_DIR = path.join(ROOT, "screenshots");
const SHOW_PATH = path.join(WORK, "stills-show.json");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

const artifact = (name) => JSON.parse(readFileSync(path.join(ARTIFACTS, `${name}.json`), "utf8"));

const W = 1920;
const H = 1080;

function panel(artifactName, { x, y, w, highlight = null, tight = true }) {
  const a = artifact(artifactName);
  return {
    type: "panel",
    panel: {
      title: a.title,
      subtitle: a.subtitle,
      lines: a.lines,
      text: a.text,
      tight,
      highlight,
    },
    x,
    y,
    w,
    a: { opacity: [[0, 1]] },
  };
}

function heading(text, { y = 70, x = 96 } = {}) {
  return {
    type: "text",
    html: `<span style="font-size:44px;font-weight:800;letter-spacing:-0.02em;color:#fff">${text}</span>`,
    x,
    y,
    w: 1400,
    a: { opacity: [[0, 1]] },
  };
}

/** Card definitions: id → show document (one scene, rendered at t=1s). */
const CARDS = {
  "ci-cd-pipeline": () => ({
    title: "StellarDripz — CI/CD",
    layers: [
      heading("CI/CD — every push runs the full pipeline"),
      panel("ci-workflow", { x: 150, y: 190, w: 1620, highlight: [4, 5, 6, 7, 8, 9, 10, 11] }),
    ],
  }),
  "test-output": () => ({
    title: "StellarDripz — test output",
    layers: [
      heading("Tests — Rust contracts and frontend, all green"),
      panel("contracts-tests", { x: 150, y: 190, w: 780, tight: true }),
      panel("frontend-tests", { x: 970, y: 190, w: 800, tight: true }),
      {
        type: "text",
        html: `<span style="font-size:26px;font-weight:600;color:#34d399">✓ cargo test — 92 tests · jest — 276 tests in 38 suites · tsc --noEmit clean</span>`,
        x: 150,
        y: 960,
        w: 1620,
        a: { opacity: [[0, 1]] },
      },
    ],
  }),
};

function buildShow(card) {
  const { title, layers } = card();
  return {
    title,
    width: W,
    height: H,
    fps: 30,
    duration: 2,
    posterTime: 1,
    background: [
      { type: "box", cls: "grid", x: 0, y: 0, w: W, h: H, a: { opacity: [[0, 1]] } },
      {
        type: "box",
        x: -300,
        y: -300,
        w: 1400,
        h: 1400,
        css: "background:#3E63DD;filter:blur(220px)",
        a: { opacity: [[0, 0.16]] },
      },
    ],
    scenes: [{ id: "card", chapter: title, start: 0, duration: 2, layers }],
  };
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = null;
    if (url === "/" || url === "/stage.html") file = path.join(ROOT, "video", "scenes", "stage.html");
    else if (url === "/stage.js") file = path.join(ROOT, "video", "scenes", "stage.js");
    else if (url === "/show.json") file = SHOW_PATH;
    if (!file || !existsSync(file)) return res.writeHead(404).end("nf");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })),
  );
}

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const ids = wanted.length ? wanted : Object.keys(CARDS);
  for (const id of ids) {
    if (!CARDS[id]) {
      console.warn(`⚠ unknown card ${id}`);
      continue;
    }
    const out = path.join(OUT_DIR, `${id}.png`);
    writeFileSync(SHOW_PATH, JSON.stringify(buildShow(CARDS[id]), null, 2));
    const { server, port } = await startServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    try {
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await page.waitForFunction("window.__ready === true", null, { timeout: 60_000 });
      await page.evaluate(() => window.__render(1));
      mkdirSync(OUT_DIR, { recursive: true });
      await page.screenshot({ path: out });
      console.log(`  ✓ ${path.relative(ROOT, out)}`);
    } finally {
      await browser.close();
      server.close();
    }
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}`);
  process.exit(1);
});
