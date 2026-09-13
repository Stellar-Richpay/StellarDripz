#!/usr/bin/env node
/**
 * Compile the video source material into `show.json` plus web-ready assets.
 *
 *   captures (video/.work/stills|clips)  ─┐
 *   artifacts (video/.work/artifacts)    ─┼─→ video/.work/show.json
 *   video/script.json + durations        ─┘   video/.work/assets/**
 *
 * Still captures are 2× PNGs; the stage needs JPEGs at the same resolution so
 * zooms stay crisp, so they are transcoded once (and cached) here.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildShow } from "./scenes.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORK = path.join(ROOT, "video", ".work");
const ASSETS = path.join(WORK, "assets");
const SHOW_PATH = path.join(WORK, "show.json");

function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Transcode a PNG capture to JPEG at the same pixel size (cached by mtime). */
function toJpeg(src, dest, quality = 3) {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) return;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-q:v", String(quality), dest]);
}

function prepareAssets(manifest) {
  let count = 0;
  for (const [name, still] of Object.entries(manifest.stills)) {
    const src = path.join(WORK, still.file);
    const dest = path.join(ASSETS, "stills", `${name}.jpg`);
    if (existsSync(src)) {
      toJpeg(src, dest);
      count += 1;
    }
  }
  for (const [name, clip] of Object.entries(manifest.clips)) {
    for (const frame of clip.frames) {
      const src = path.join(WORK, frame.file);
      const dest = path.join(ASSETS, "clips", name, path.basename(frame.file));
      mkdirSync(path.dirname(dest), { recursive: true });
      if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs) {
        // Frame sequences are already JPEG; copy rather than re-encode.
        writeFileSync(dest, readFileSync(src));
      }
    }
    count += clip.frames.length;
  }
  console.log(`  ✓ assets (${count} images)`);
}

function loadArtifacts() {
  const dir = path.join(WORK, "artifacts");
  if (!existsSync(dir)) return {};
  const artifacts = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const parsed = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    if (parsed.kind === "stats") continue;
    artifacts[file.replace(/\.json$/, "")] = parsed;
  }
  return artifacts;
}

function main() {
  const manifest = readJson(path.join(WORK, "manifest.json"));
  if (!manifest) {
    console.error("✗ no capture manifest — run video/scripts/capture.mjs first");
    process.exit(1);
  }
  const script = readJson(path.join(ROOT, "video", "script.json"));
  const durations = readJson(path.join(WORK, "durations.json"), []);
  const stats = readJson(path.join(WORK, "artifacts", "stats.json"), {});
  const artifacts = loadArtifacts();

  console.log("▶ build show");
  prepareAssets(manifest);

  const show = buildShow({ manifest, artifacts, stats, script, durations });
  writeFileSync(SHOW_PATH, JSON.stringify(show, null, 2));

  const missing = [];
  for (const scene of show.scenes) {
    for (const layer of scene.layers) {
      if (layer.type === "img" && layer.src) {
        const file = path.join(ASSETS, layer.src.replace("/assets/", ""));
        if (!existsSync(file)) missing.push(`${scene.id}: ${layer.src}`);
      }
      if (layer.type === "clip") {
        for (const frame of layer.frames) {
          const file = path.join(ASSETS, frame.src.replace("/assets/", ""));
          if (!existsSync(file)) missing.push(`${scene.id}: ${frame.src}`);
        }
      }
    }
  }
  if (missing.length) {
    console.warn(`  ⚠ missing assets:\n${missing.slice(0, 20).map((m) => `     ${m}`).join("\n")}`);
  }

  console.log(
    `  ✓ show.json — ${show.scenes.length} scenes · ${show.duration.toFixed(1)}s · ${show.fps}fps`,
  );
}

main();
