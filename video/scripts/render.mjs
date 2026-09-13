#!/usr/bin/env node
/**
 * Render the pitch video.
 *
 *   frames  — Chromium renders `show.json` frame by frame (deterministic, no
 *             wall-clock animation) into video/.work/frames
 *   audio   — scene voice-overs are placed on the timeline at their own start
 *             offsets, over a very quiet synth pad
 *   encode  — frames + master audio → public/video/stellardripz-pitch.mp4
 *
 *   node video/scripts/render.mjs                    # everything
 *   node video/scripts/render.mjs --only 01-problem  # one scene (fast QA)
 *   node video/scripts/render.mjs --no-render        # re-encode existing frames
 *   node video/scripts/render.mjs --variants-only    # just the 720p copy + GIF
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORK = path.join(ROOT, "video", ".work");
const ASSETS = path.join(WORK, "assets");
const FRAMES = path.join(WORK, "frames");
const OUT_DIR = path.join(ROOT, "public", "video");
const OUT_MP4 = path.join(OUT_DIR, "stellardripz-pitch.mp4");
const OUT_720 = path.join(OUT_DIR, "stellardripz-pitch-720p.mp4");
const OUT_GIF = path.join(OUT_DIR, "stellardripz-pitch-preview.gif");
const OUT_POSTER = path.join(OUT_DIR, "stellardripz-pitch-poster.jpg");
const OUT_VTT = path.join(OUT_DIR, "stellardripz-pitch.vtt");
const TRANSCRIPT = path.join(ROOT, "video", "transcript.md");

const argv = process.argv.slice(2);
const argValue = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};
const FPS = Number(argValue("--fps") || 30);
const ONLY = argValue("--only") ? argValue("--only").split(",") : null;
const NO_RENDER = argv.includes("--no-render");
const VARIANTS_ONLY = argv.includes("--variants-only");

const show = JSON.parse(readFileSync(path.join(WORK, "show.json"), "utf8"));
const script = JSON.parse(readFileSync(path.join(ROOT, "video", "script.json"), "utf8"));
/** Measured narration length per scene (seconds), used to time the captions. */
const durations = JSON.parse(readFileSync(path.join(WORK, "durations.json"), "utf8"));

// ---- static server for the stage and its assets -----------------------------

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = null;
    if (url === "/" || url === "/stage.html") file = path.join(ROOT, "video", "scenes", "stage.html");
    else if (url === "/stage.js") file = path.join(ROOT, "video", "scenes", "stage.js");
    else if (url === "/show.json") file = path.join(WORK, "show.json");
    else if (url.startsWith("/assets/")) file = path.join(ASSETS, url.replace("/assets/", ""));

    if (!file || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

// ---- frame rendering --------------------------------------------------------

async function renderFrames() {
  const { server, port } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: show.width, height: show.height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error(`  ⚠ page error: ${err.message}`));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", null, { timeout: 120_000 });

  const ranges = ONLY
    ? show.scenes
        .filter((s) => ONLY.includes(s.id))
        .map((s) => ({ start: s.start, end: s.start + s.duration }))
    : [{ start: 0, end: show.duration }];

  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });

  let index = 0;
  const started = Date.now();
  for (const range of ranges) {
    const total = Math.round((range.end - range.start) * FPS);
    for (let i = 0; i < total; i += 1) {
      const t = range.start + i / FPS;
      await page.evaluate((time) => window.__render(time), t);
      const file = path.join(FRAMES, `${String(index).padStart(5, "0")}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 92 });
      index += 1;
      if (index % 90 === 0 || index === 1) {
        const rate = index / ((Date.now() - started) / 1000);
        console.log(
          `    ${index}/${total} frames · ${rate.toFixed(1)} fps · eta ${Math.round(
            (total - index) / Math.max(rate, 0.1) / 60,
          )} min`,
        );
      }
    }
  }

  // Poster: a still of the end card.
  await page.evaluate((time) => window.__render(time), show.posterTime);
  mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(WORK, "poster.png") });
  console.log("    ✓ poster frame");

  await browser.close();
  server.close();
  console.log(`  ✓ ${index} frames rendered`);
  return index;
}

// ---- audio timeline ---------------------------------------------------------

function buildAudio() {
  const inputs = [];
  const filters = [];
  const labels = [];

  show.scenes
    .filter((s) => s.id !== "poster")
    .forEach((s, i) => {
      const file = path.join(ROOT, "video", ".work", "audio", `${s.id}.wav`);
      if (!existsSync(file)) return;
      inputs.push("-i", file);
      const delay = Math.round((s.start + 0.4) * 1000);
      filters.push(`[${i}:a]adelay=${delay}|${delay}[vo${i}]`);
      labels.push(`[vo${i}]`);
    });

  const voIndex = inputs.filter((a) => a === "-i").length;
  filters.push(
    `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[vo]`,
  );
  // A near-subliminal pad: three sines through a low-pass with a slow tremolo.
  inputs.push(
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=110:duration=${(show.duration + 4).toFixed(2)}`,
  );
  const pad = voIndex;
  filters.push(
    `[${pad}:a]volume=0.05,lowpass=f=700,tremolo=f=0.12:d=0.4,` +
      `afade=t=in:st=0:d=3,afade=t=out:st=${(show.duration - 3).toFixed(2)}:d=3[pad]`,
  );
  filters.push(`[vo][pad]amix=inputs=2:normalize=0:weights=1 1[loud]`);
  filters.push(`[loud]loudnorm=I=-16:TP=-1.5:LRA=11[out]`);

  const master = path.join(WORK, "master.wav");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[out]",
      "-ar",
      "48000",
      "-ac",
      "2",
      master,
    ],
    { stdio: "inherit" },
  );
  console.log("  ✓ master audio");
  return master;
}

// ---- encode -----------------------------------------------------------------

/**
 * Encode the frame sequence to the 1080p master.
 *
 * The rate/distortion settings are a size budget decision, not a default: the
 * video is committed to the repository, so crf 29 + preset slow keeps the whole
 * thing around 12 MB while measuring ~0.993 SSIM against a crf 20 encode (i.e.
 * visually identical on UI footage, which is where the bytes go).
 */
function encode(master) {
  mkdirSync(OUT_DIR, { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(FPS),
      "-i",
      path.join(FRAMES, "%05d.jpg"),
      "-i",
      master,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "29",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "high",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "112k",
      "-shortest",
      OUT_MP4,
    ],
    { stdio: "inherit" },
  );
  console.log(`  ✓ ${path.relative(ROOT, OUT_MP4)} (${mb(OUT_MP4)} MB)`);
}

/** Megabyte count of a file (decimal MB, to match the sizes quoted in the README). */
function mb(file) {
  return (statSync(file).size / 1e6).toFixed(1);
}

// ---- chapters ---------------------------------------------------------------

/**
 * MP4 chapter markers, one per scene.
 *
 * Chapters live in their own track and the timeline is already known here, so
 * they are generated from `show.json` rather than hand-written — players
 * (QuickTime, VLC, YouTube after upload) then expose the nine beats for free.
 */
function writeChapters() {
  const scenes = show.scenes.filter((s) => s.id !== "poster");
  const ms = (seconds) => Math.round(seconds * 1000);
  const lines = [";FFMETADATA1", `title=${show.title}`, ""];
  scenes.forEach((scene, i) => {
    const next = scenes[i + 1];
    lines.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${ms(scene.start)}`,
      `END=${ms(next ? next.start : scene.start + scene.duration)}`,
      `title=${scene.chapter || scene.id}`,
      "",
    );
  });
  const meta = path.join(WORK, "chapters.ffmetadata");
  writeFileSync(meta, lines.join("\n"));

  // Only the chapter track changes, so the encoded streams are copied — no
  // quality loss and no second full encode.
  const stamped = path.join(WORK, "chapters.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      OUT_MP4,
      "-i",
      meta,
      // A metadata input carries both the tags and the chapter list.
      "-map_metadata",
      "1",
      "-codec",
      "copy",
      "-movflags",
      "+faststart",
      stamped,
    ],
    { stdio: "inherit" },
  );
  renameSync(stamped, OUT_MP4);
  console.log(`  ✓ ${scenes.length} chapters`);
}

// ---- lighter variants -------------------------------------------------------

/**
 * A 720p companion (for slow connections / smaller repos) and an animated GIF
 * preview, because a README cannot embed a video but it can show a few seconds
 * of one. Both are cut from the finished MP4 so they can never drift from it.
 */
function writeVariants() {
  // crf 31 (rather than a fixed “half the master's bitrate”): the 720p copy is
  // re-encoded from an already compressed master, so it needs a wider crf gap
  // than the resolution drop alone to actually come out lighter.
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      OUT_MP4,
      "-vf",
      "scale=1280:-2",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "31",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "112k",
      OUT_720,
    ],
    { stdio: "inherit" },
  );
  console.log(`  ✓ ${path.relative(ROOT, OUT_720)} (${mb(OUT_720)} MB)`);

  // Six beats, in narrative order: the problem, the funded faucet, a payment,
  // contract actions, the test panels and the production deployment.
  const picks = [0, 2, 3, 4, 6, 8]
    .map((i) => show.scenes.filter((s) => s.id !== "poster")[i])
    .filter(Boolean)
    .map((scene) => scene.start + scene.duration * 0.45);
  const HOLD = 1.2;
  // Each beat is cut on its own, then joined with the concat demuxer.
  // A single six-way trim/concat graph needs the decoder to hold six 1080p
  // segments in flight at once, which spikes memory hard enough that the
  // process gets killed; one ffmpeg per beat stays tiny and is just as exact.
  const parts = picks.map((start, i) => {
    const file = path.join(WORK, `preview-${i}.mp4`);
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        start.toFixed(2),
        "-t",
        String(HOLD),
        "-i",
        OUT_MP4,
        "-vf",
        "scale=640:-2:flags=lanczos,fps=10",
        "-an",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        file,
      ],
      { stdio: "inherit" },
    );
    return file;
  });
  const listFile = path.join(WORK, "preview-concat.txt");
  writeFileSync(listFile, parts.map((f) => `file '${f}'`).join("\n"));
  const beats = path.join(WORK, "preview.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      beats,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      beats,
      "-vf",
      "fps=10,scale=640:-2:flags=lanczos,split[a][b];" +
        "[a]palettegen=max_colors=96:stats_mode=diff[pal];" +
        "[b][pal]paletteuse=dither=bayer:bayer_scale=3",
      "-loop",
      "0",
      OUT_GIF,
    ],
    { stdio: "inherit" },
  );
  console.log(`  ✓ ${path.relative(ROOT, OUT_GIF)} (${mb(OUT_GIF)} MB)`);
}

function writePoster() {
  const src = path.join(WORK, "poster.png");
  if (!existsSync(src)) return;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-q:v", "3", OUT_POSTER]);
  console.log(`  ✓ ${path.relative(ROOT, OUT_POSTER)}`);
}

function writeCaptions() {
  const stamp = (seconds) => {
    const ms = Math.round(seconds * 1000);
    const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
    const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
    const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
    return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, "0")}`;
  };

  const cues = [];
  const transcript = [
    "# StellarDripz — product pitch transcript",
    "",
    "Voice-over narration for `public/video/stellardripz-pitch.mp4` (the same",
    "text lives in [script.json](./script.json)).",
    "",
  ];

  show.scenes
    .filter((s) => s.id !== "poster")
    .forEach((scene, i) => {
      const narration = script.scenes[i]?.narration || "";
      // The voice-over is placed at the scene's lead-in (see buildAudio) and
      // lasts exactly as long as the measured take — using the scene's visual
      // duration here would run each cue on past the end of its narration.
      const start = scene.start + 0.4;
      const end = start + (durations[i]?.seconds ?? scene.duration);
      cues.push(
        String(i + 1),
        `${stamp(start)} --> ${stamp(end)}`,
        narration.replace(/\s+/g, " ").trim(),
        "",
      );
      transcript.push(
        `## ${scene.chapter || scene.id}`,
        "",
        `_[${stamp(start).slice(3, 8)}]_ ${narration}`,
        "",
      );
    });

  writeFileSync(OUT_VTT, ["WEBVTT", "", ...cues].join("\n"));
  writeFileSync(TRANSCRIPT, transcript.join("\n"));
  console.log(`  ✓ ${path.relative(ROOT, OUT_VTT)} · ${path.relative(ROOT, TRANSCRIPT)}`);
}

async function main() {
  if (VARIANTS_ONLY) {
    console.log("▶ variants (720p + GIF)");
    writeVariants();
    console.log("✓ done");
    return;
  }
  console.log(`▶ render (${show.duration.toFixed(1)}s · ${FPS}fps${ONLY ? ` · only ${ONLY}` : ""})`);
  if (!NO_RENDER) await renderFrames();
  const master = buildAudio();
  encode(master);
  writeChapters();
  writePoster();
  writeCaptions();
  writeVariants();
  console.log("✓ done");
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}`);
  process.exit(1);
});
