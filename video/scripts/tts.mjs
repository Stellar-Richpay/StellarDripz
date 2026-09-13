#!/usr/bin/env node
/**
 * Generate the Gemini voice-over for each scene in video/script.json.
 *
 * Gemini TTS returns raw 16-bit little-endian PCM at 24 kHz mono; we wrap it
 * in a WAV container so ffmpeg (and any human) can read it back.
 *
 *   node video/scripts/tts.mjs                 # all scenes
 *   node video/scripts/tts.mjs 05-contracts    # one scene
 *   STYLE="" node video/scripts/tts.mjs        # drop the style direction
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORK = path.join(ROOT, "video", ".work");
const AUDIO_DIR = path.join(WORK, "audio");

// ---- config ----
function loadEnv() {
  const file = path.join(ROOT, ".env.video.local");
  if (!existsSync(file)) throw new Error("Missing .env.video.local (GEMINI_API_KEY)");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BITS = 16;

/**
 * Style direction. Gemini TTS treats a leading instruction as direction rather
 * than script (the docs' own examples use "Say cheerfully: ..."), but we verify
 * that assumption in `checkDuration` below instead of trusting it.
 */
const DEFAULT_STYLE =
  "Read this as a confident, upbeat startup product-pitch narrator. Natural pace, warm and clear, no exaggerated drama.";

function wavHeader(dataLength) {
  const header = Buffer.alloc(44);
  const byteRate = (SAMPLE_RATE * CHANNELS * BITS) / 8;
  const blockAlign = (CHANNELS * BITS) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

async function synthesize({ text, voice, model, apiKey, attempt = 1 }) {
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    // 429/5xx are transient — back off and retry rather than failing the build.
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      const waitMs = 2000 * attempt;
      console.log(`    ↻ ${res.status}; retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      return synthesize({ text, voice, model, apiKey, attempt: attempt + 1 });
    }
    throw new Error(`TTS ${res.status}: ${detail}`);
  }

  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) {
    throw new Error(`No audio in response: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return {
    pcm: Buffer.from(part.inlineData.data, "base64"),
    mimeType: part.inlineData.mimeType,
  };
}

/** Read a media file's duration in seconds via ffprobe. */
function duration(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return parseFloat(out.trim());
}

/** Sanity-check that the delivery isn't reading our style direction aloud. */
function checkDuration(id, words, seconds, expected) {
  if (seconds > expected * 1.45) {
    console.log(
      `    ⚠ ${id}: ${seconds.toFixed(1)}s for ${words} words — slower than expected; the style line may be spoken.`,
    );
    return false;
  }
  return true;
}

async function main() {
  loadEnv();
  const script = JSON.parse(readFileSync(path.join(ROOT, "video", "script.json"), "utf8"));
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const only = process.argv[2];
  const style = process.env.STYLE === undefined ? DEFAULT_STYLE : process.env.STYLE;
  const voice = process.env.VOICE || script.voice;
  const model = process.env.MODEL || script.model;

  mkdirSync(AUDIO_DIR, { recursive: true });

  const results = [];
  for (const scene of script.scenes) {
    if (only && scene.id !== ` ${only}`.trim()) {
      const existing = path.join(AUDIO_DIR, `${scene.id}.wav`);
      if (existsSync(existing)) {
        results.push({ id: scene.id, target: scene.target, seconds: duration(existing) });
      }
      continue;
    }

    const prompt = style ? `${style}\n\n${scene.narration}` : scene.narration;
    console.log(`▶ ${scene.id} (${voice})`);

    const started = Date.now();
    const { pcm, mimeType } = await synthesize({ text: prompt, voice, model, apiKey });
    const wav = Buffer.concat([wavHeader(pcm.length), pcm]);
    const file = path.join(AUDIO_DIR, `${scene.id}.wav`);
    writeFileSync(file, wav);

    const seconds = duration(file);
    const words = scene.narration.split(/\s+/).length;
    checkDuration(scene.id, words, seconds, scene.target);
    console.log(
      `    ✓ ${seconds.toFixed(2)}s · ${words} words · ${(words / seconds).toFixed(2)} w/s · ${mimeType} · ${Date.now() - started}ms`,
    );
    results.push({ id: scene.id, target: scene.target, seconds, words });
  }

  const total = results.reduce((a, r) => a + r.seconds, 0);
  writeFileSync(path.join(WORK, "durations.json"), JSON.stringify(results, null, 2));
  console.log(`\nTotal narration: ${total.toFixed(2)}s across ${results.length} scenes`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
