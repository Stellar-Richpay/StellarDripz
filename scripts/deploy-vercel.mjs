#!/usr/bin/env node
/**
 * Deploy this working tree to the StellarDripz Vercel project (production).
 *
 * The repo's normal deploy path is Vercel's Git integration, which needs the
 * GitHub App to be authorised for the repository, plus `VERCEL_TOKEN` for the
 * CI deploy jobs. When neither is available this script talks to the public
 * REST API directly, so a release can still be shipped from a plain checkout:
 *
 *   VERCEL_TOKEN=... node scripts/deploy-vercel.mjs
 *
 * It uploads the *tracked* files (same set Vercel would receive from Git,
 * `video/.work/` and other build scratch space are excluded by .vercelignore)
 * using the documented file-hash flow — hash first, upload only what Vercel
 * does not already have — then creates and waits on a production deployment.
 *
 * Env:
 *   VERCEL_TOKEN   required, a Vercel access token
 *   VERCEL_ORG_ID  optional, defaults to the StellarDripz team
 *   VERCEL_PROJECT_ID optional, defaults to the StellarDripz project
 *   DEPLOY_TARGET  optional, "production" (default) or "preview"
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ORG_ID = process.env.VERCEL_ORG_ID ?? "team_jug30FRlPO9NtzfmVeEZzlCI";
const PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? "prj_sXgRXmGcWtvYISQhfm7fNObTyFVu";
const TARGET = process.env.DEPLOY_TARGET ?? "production";
const TOKEN = process.env.VERCEL_TOKEN;
const API = "https://api.vercel.com";

if (!TOKEN) {
  console.error("VERCEL_TOKEN is required (see .env.vercel.local for local runs).");
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${TOKEN}` };

const api = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, ok: res.ok, body };
};

/** Tracked files only — mirrors what Vercel receives when building from Git. */
const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" })
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((file) => {
    try {
      return statSync(resolve(file)).isFile();
    } catch {
      return false; // tracked but deleted in the working tree
    }
  });

console.log(`Uploading ${trackedFiles.length} tracked files to ${TARGET} on ${PROJECT_ID}…`);

const manifest = [];
let uploaded = 0;
let reused = 0;
let bytes = 0;

const CONCURRENCY = 4;
let cursor = 0;

const worker = async () => {
  while (cursor < trackedFiles.length) {
    const file = trackedFiles[cursor++];
    const full = resolve(file);
    const data = readFileSync(full);
    const stat = statSync(full);
    const sha = createHash("sha1").update(data).digest("hex");

    const res = await api(`/v2/files?teamId=${ORG_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-vercel-digest": sha,
        "Content-Length": String(data.byteLength),
      },
      body: data,
    });

    // 200 = stored, 409 = already known to Vercel (same content hash).
    if (!res.ok && res.status !== 409) {
      throw new Error(
        `upload failed for ${file} (${res.status}): ${JSON.stringify(res.body).slice(0, 400)}`,
      );
    }
    if (res.status === 409) reused++;
    else uploaded++;

    bytes += data.byteLength;
    manifest.push({
      file,
      sha,
      size: data.byteLength,
      ...(stat.mode & 0o111 ? { mode: 0o100755 } : {}),
    });
  }
};

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(
  `Uploaded ${uploaded} new / ${reused} already present (${(bytes / 1e6).toFixed(1)} MB).`,
);

const created = await api(`/v13/deployments?teamId=${ORG_ID}&forceNew=1`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "stellardripz",
    project: PROJECT_ID,
    target: TARGET,
    files: manifest,
    projectSettings: { framework: "nextjs" },
  }),
});

if (!created.ok) {
  console.error(
    `Could not create deployment (${created.status}):`,
    JSON.stringify(created.body).slice(0, 1000),
  );
  process.exit(1);
}

const id = created.body.id;
console.log(`Deployment ${id} created — building…`);

const TERMINAL = new Set(["READY", "ERROR", "CANCELED"]);
let state = "QUEUED";

for (let attempt = 0; attempt < 90 && !TERMINAL.has(state); attempt++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const res = await api(`/v13/deployments/${id}?teamId=${ORG_ID}`);
  state = res.body.readyState ?? res.body.status ?? state;
  process.stdout.write(`  ${new Date().toISOString()} ${state}\n`);
}

if (state !== "READY") {
  const events = await api(
    `/v3/deployments/${id}/events?teamId=${ORG_ID}&builds=1&direction=backward&limit=200`,
  );
  const events_ = Array.isArray(events.body) ? events.body : (events.body.events ?? []);
  for (const e of events_.reverse()) {
    const text = e.payload?.text ?? e.payload?.message;
    if (text) console.log(`[${e.type}] ${String(text).slice(0, 2000)}`);
  }
  console.error(`Deployment ${id} finished as ${state}.`);
  process.exit(1);
}

const final = await api(`/v13/deployments/${id}?teamId=${ORG_ID}`);
console.log(`Ready: https://${final.body.url}`);
for (const alias of final.body.alias ?? []) console.log(`Alias: https://${alias}`);
