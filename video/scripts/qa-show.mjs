#!/usr/bin/env node
/**
 * Layout QA for the rendered show.
 *
 * The video is produced unattended and headless, so this pass gives a textual
 * read of what is on screen: at sampled times it reports the visible text,
 * flags layers that leave the frame, text that overflows its box and text
 * blocks that overlap each other.
 *
 *   node video/scripts/qa-show.mjs [times...] (default: a fixed sample set)
 */
import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORK = path.join(ROOT, "video", ".work");
const ASSETS = path.join(WORK, "assets");
const show = JSON.parse(readFileSync(path.join(WORK, "show.json"), "utf8"));

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = null;
    if (url === "/" || url === "/stage.html") file = path.join(ROOT, "video", "scenes", "stage.html");
    else if (url === "/stage.js") file = path.join(ROOT, "video", "scenes", "stage.js");
    else if (url === "/show.json") file = path.join(WORK, "show.json");
    else if (url.startsWith("/assets/")) file = path.join(ASSETS, url.replace("/assets/", ""));
    if (!file || !existsSync(file)) return res.writeHead(404).end("nf");
    // The stage is a module script, so the MIME type has to be explicit or
    // Chrome refuses to execute it (and the page never reports `__ready`).
    const type = MIME[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type }).end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })),
  );
}

/** Sample times: the midpoint of every shot plus scene boundaries. */
function defaultSampleTimes() {
  const times = [];
  for (const scene of show.scenes) {
    if (scene.id === "poster") continue;
    times.push(scene.start + 1.2);
    times.push(scene.start + scene.duration / 2);
    times.push(scene.start + scene.duration - 1.2);
  }
  return times.map((t) => Math.round(t * 10) / 10);
}

const REPORT = [];

async function main() {
  const argTimes = process.argv.slice(2).filter((a) => !a.startsWith("--")).map(Number);
  const times = argTimes.length ? argTimes : defaultSampleTimes();
  const { server, port } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({
    viewport: { width: show.width, height: show.height },
    deviceScaleFactor: 1,
  });
  const p = await page.newPage();
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await p.waitForFunction("window.__ready === true", null, { timeout: 120_000 });

  console.log(`# Layout QA — ${times.length} sample times\n`);
  for (const t of times) {
    await p.evaluate((time) => window.__render(time), t);
    const report = await p.evaluate(() => {
      const canvas = { w: 1920, h: 1080 };
      // `renderAt` hides a finished scene with display:none but leaves its
      // opacity at its last value, so both have to be checked here — otherwise
      // every layer of every past scene reports as a zero-size problem.
      const sceneVisible = (scene) =>
        scene.style.display !== "none" && Number(scene.style.opacity || 1) >= 0.05;
      const visible = (el) => {
        if (el.style.display === "none") return false;
        const scene = el.closest(".scene");
        if (scene && !sceneVisible(scene)) return false;
        return Number(el.style.opacity || 1) > 0.05;
      };
      // Soft glows are deliberately larger than the frame and are clipped by
      // the stage, so they are not layout bugs.
      const decorative = (el) => el.classList.contains("glow");
      const textNodes = [];
      const problems = [];
      for (const scene of document.querySelectorAll(".scene")) {
        if (!sceneVisible(scene)) continue;
        for (const el of scene.querySelectorAll(".layer")) {
          if (!visible(el)) continue;
          const r = el.getBoundingClientRect();
          const isText = el.classList.contains("txt");
          const content = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (r.width < 1 || r.height < 1) {
            problems.push(`zero-size layer (${el.className})`);
            continue;
          }
          if (decorative(el)) continue;
          if (r.left < -40 || r.top < -40 || r.right > canvas.w + 40 || r.bottom > canvas.h + 40) {
            problems.push(
              `off-frame: ${isText ? `"${content.slice(0, 40)}"` : el.className} ` +
                `[${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}]`,
            );
          }
          if (isText && el.scrollWidth > el.clientWidth + 4) {
            problems.push(`text overflow (${el.clientWidth}px box): "${content.slice(0, 60)}"`);
          }
          if (isText && content) {
            textNodes.push({ content, rect: r });
          }
        }
      }
      for (let i = 0; i < textNodes.length; i += 1) {
        for (let j = i + 1; j < textNodes.length; j += 1) {
          const a = textNodes[i].rect;
          const b = textNodes[j].rect;
          const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapW <= 0 || overlapH <= 0) continue;
          const overlap = overlapW * overlapH;
          const smaller = Math.min(a.width * a.height, b.width * b.height);
          if (overlap / smaller > 0.35) {
            problems.push(
              `text overlap: "${textNodes[i].content.slice(0, 28)}" ↔ "${textNodes[j].content.slice(0, 28)}" (${Math.round((overlap / smaller) * 100)}%)`,
            );
          }
        }
      }
      return { texts: textNodes.map((n) => n.content.slice(0, 120)), problems };
    });
    const label = `t=${t.toFixed(1)}s`;
    console.log(`## ${label}`);
    console.log(`- on screen: ${report.texts.filter(Boolean).join(" | ") || "(no text)"}`);
    for (const problem of report.problems) console.log(`- ⚠ ${problem}`);
    console.log("");
    REPORT.push({ t, ...report });
  }

  await browser.close();
  server.close();
  const problemCount = REPORT.reduce((n, r) => n + r.problems.length, 0);
  console.log(`✓ QA complete — ${problemCount} problem(s)`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}`);
  process.exit(1);
});
