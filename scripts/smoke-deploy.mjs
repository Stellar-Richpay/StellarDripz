#!/usr/bin/env node
/**
 * Post-deploy smoke test for the live StellarDripz deployment.
 *
 * Runs after a Vercel deploy (and nightly on a schedule) to catch the two ways a
 * "successful" deployment can still be wrong for visitors:
 *
 *   1. the pitch video is not actually served — missing from `public/video`, a
 *      wrong content type, a truncated file, or a redirect to the 404 page;
 *   2. the landing page no longer links to it, so nobody can find the video.
 *
 * It only makes plain HTTP requests, so it works against any deployment URL:
 *
 *   npm run smoke:deploy                                   # production alias
 *   SMOKE_BASE_URL=https://preview.vercel.app npm run smoke:deploy
 *
 * Env:
 *   SMOKE_BASE_URL  deployment to check (default: https://stellardripz.vercel.app)
 *   SMOKE_ATTEMPTS  how many times to retry the whole suite (default: 5)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = (
  process.env.SMOKE_BASE_URL ??
  process.env.BASE_URL ??
  "https://stellardripz.vercel.app"
).replace(/\/+$/, "");
const ATTEMPTS = Math.max(1, Number(process.env.SMOKE_ATTEMPTS ?? 5));
// Resolved from this file so the script works from any working directory.
const VIDEO_DIR = fileURLToPath(new URL("../public/video", import.meta.url));

/** Assets the README and the hero link to, with the type and size we expect. */
const VIDEO_ASSETS = [
  {
    path: "/video/stellardripz-pitch.mp4",
    type: "video/mp4",
    minBytes: 5_000_000,
    local: "stellardripz-pitch.mp4",
  },
  {
    path: "/video/stellardripz-pitch-720p.mp4",
    type: "video/mp4",
    minBytes: 2_000_000,
    local: "stellardripz-pitch-720p.mp4",
  },
  {
    path: "/video/stellardripz-pitch-preview.gif",
    type: "image/gif",
    minBytes: 500_000,
    local: "stellardripz-pitch-preview.gif",
  },
  {
    path: "/video/stellardripz-pitch-poster.jpg",
    type: "image/jpeg",
    minBytes: 20_000,
    local: "stellardripz-pitch-poster.jpg",
  },
  {
    path: "/video/stellardripz-pitch.vtt",
    type: "text/vtt",
    minBytes: 500,
    local: "stellardripz-pitch.vtt",
  },
];

/** Copy the landing page must still contain for the video to be discoverable. */
const HERO_EXPECTATIONS = [
  { label: "hero button label", text: "Watch the 2-minute pitch" },
  { label: "hero video link", text: "/video/stellardripz-pitch.mp4" },
  { label: "hero repo link", text: "https://github.com/Stellar-Richpay/StellarDripz" },
];

const CONTRACTS = ["counter", "dripToken", "dripPool", "governance", "badge"];

const failures = [];
const notes = [];

const fail = (message) => failures.push(message);

const request = async (path, init = {}) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
    ...init,
  });
  return res;
};

const checkHomePage = async () => {
  const res = await request("/");
  if (res.status !== 200) return fail(`GET / returned ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html"))
    return fail(`GET / content-type was "${type}", expected text/html`);
  const html = await res.text();
  if (html.length < 2_000 && /not found/i.test(html)) fail("GET / looks like the 404 page");
  for (const { label, text } of HERO_EXPECTATIONS) {
    if (!html.includes(text))
      fail(`landing page is missing the ${label} (${JSON.stringify(text)})`);
  }
};

/**
 * Total size of a static asset as the deployment reports it.
 *
 * Vercel omits `content-length` on HEAD for these files, so the size comes from
 * the `content-range` of a one-byte range request, with HEAD and then a full GET
 * as fallbacks for other hosts.
 */
const assetSize = async (path) => {
  const ranged = await request(path, { headers: { Range: "bytes=0-0" } });
  const contentRange = ranged.headers.get("content-range");
  const total = contentRange?.match(/\/(\d+)$/)?.[1];
  if (total) return Number(total);

  const head = await request(path, { method: "HEAD" });
  const headLength = Number(head.headers.get("content-length") ?? 0);
  if (headLength > 0) return headLength;

  const full = await request(path);
  return Buffer.from(await full.arrayBuffer()).byteLength;
};

const checkAsset = async ({ path, type, minBytes, local }) => {
  // Range request first: proves the file is streamable and typed correctly
  // without pulling the whole MP4 down on every run.
  const ranged = await request(path, { headers: { Range: "bytes=0-1023" } });
  if (ranged.status !== 206 && ranged.status !== 200) {
    return fail(`GET ${path} returned ${ranged.status}`);
  }
  const contentType = ranged.headers.get("content-type") ?? "";
  if (!contentType.includes(type))
    fail(`GET ${path} content-type was "${contentType}", expected ${type}`);
  const partial = Buffer.from(await ranged.arrayBuffer());
  if (partial.byteLength === 0) fail(`GET ${path} returned an empty body`);
  if (ranged.status === 206 && partial.byteLength !== 1024)
    fail(`GET ${path} range request returned ${partial.byteLength} bytes, expected 1024`);

  const size = await assetSize(path);
  if (size < minBytes)
    fail(`${path} is ${size} bytes on the deployment, expected at least ${minBytes}`);

  // The deployed master MP4 must be byte-for-byte the committed one — a stale
  // or truncated upload is the failure mode a status code cannot catch.
  const localPath = resolve(VIDEO_DIR, local);
  if (existsSync(localPath)) {
    const localSize = readFileSync(localPath).byteLength;
    if (size !== localSize)
      fail(`${path} is ${size} bytes on the deployment but ${localSize} bytes in the repo`);
  } else {
    notes.push(`skipped size comparison for ${path} (not in this checkout)`);
  }
};

const checkAllCommittedAssetsAreServed = async () => {
  if (!existsSync(VIDEO_DIR)) return;
  for (const name of readdirSync(VIDEO_DIR)) {
    const res = await request(`/video/${name}`, { method: "HEAD" });
    if (res.status !== 200)
      fail(`/video/${name} exists in the repo but returned ${res.status} on the deployment`);
  }
};

const checkHealth = async () => {
  const res = await request("/api/health");
  if (res.status !== 200) return fail(`GET /api/health returned ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch {
    return fail("GET /api/health did not return JSON");
  }
  for (const name of CONTRACTS) {
    const value = body?.contracts?.[name];
    if (value !== "configured")
      fail(`/api/health reports contract "${name}" as "${value ?? "missing"}"`);
  }
  for (const [service, value] of Object.entries(body?.services ?? {})) {
    if (value !== "ok") notes.push(`/api/health reports ${service}=${value}`);
  }
};

const runSuite = async () => {
  failures.length = 0;
  notes.length = 0;
  await checkHomePage();
  for (const asset of VIDEO_ASSETS) await checkAsset(asset);
  await checkAllCommittedAssetsAreServed();
  await checkHealth();
  return failures.length === 0;
};

console.log(`Smoke testing ${BASE_URL}`);

let attempt = 0;
let ok = false;
while (attempt < ATTEMPTS && !ok) {
  attempt++;
  try {
    ok = await runSuite();
  } catch (error) {
    failures.push(`request failed: ${error instanceof Error ? error.message : String(error)}`);
    ok = false;
  }
  if (!ok && attempt < ATTEMPTS) {
    const waitMs = attempt * 10_000;
    console.log(`✗ attempt ${attempt}/${ATTEMPTS} failed — retrying in ${waitMs / 1000}s`);
    for (const failure of failures) console.log(`    • ${failure}`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

if (ok) {
  const checked = HERO_EXPECTATIONS.length + 1 + VIDEO_ASSETS.length * 2 + 1;
  console.log(
    `✅ ${checked} checks passed — landing page, hero links, the pitch video set and /api/health are live.`,
  );
  for (const note of notes) console.log(`   note: ${note}`);
  process.exit(0);
}

console.error(`❌ Smoke test failed after ${attempt} attempt${attempt === 1 ? "" : "s"}:`);
for (const failure of failures) console.error(`   • ${failure}`);
process.exit(1);
