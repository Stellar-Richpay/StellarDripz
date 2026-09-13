# Video pipeline

The product pitch at [`public/video/stellardripz-pitch.mp4`](../public/video/stellardripz-pitch.mp4)
is generated from real material — no hand-drawn mockups, no Lorem Ipsum:

```
capture.mjs ─────────────┐
  real UI stills         │
  (2×, with element      │
   bounding boxes)       │
  wall-clock clips       ├─→ build-show.mjs ─→ render.mjs ─→ public/video/*.mp4
  terminal artifacts     │      show.json          frames + audio
  live deployment JSON ──┘      + assets          + captions + poster
                                     ▲
                        script.json + durations.json
                        (narration, Gemini TTS)
```

| File | Role |
|------|------|
| `script.json` | Narrative: chapter, narration, target duration, visual intent per scene |
| `scripts/tts.mjs` | Gemini voice-over per scene → `.work/audio/*.wav` + `durations.json` |
| `scripts/capture.mjs` | Drives the real app in headless Chromium: high-DPI stills with element marks, wall-clock clips, flow digests |
| `scripts/lib/wallet-stub.mjs` | The only test double — an in-page wallet extension that signs with a throwaway keypair |
| `scripts/collect-artifacts.mjs` | Verbatim `cargo test` / `jest` / `tsc` / `lint` output, the CI workflow, live `/api/health`, source excerpts |
| `scripts/lib/stagekit.mjs` | Authoring kit: marks → keyframed zooms, spots, callouts, panels, diagrams, stats |
| `scripts/scenes.mjs` | The nine scenes, timed against the measured narration |
| `scripts/build-show.mjs` | Compiles everything into `.work/show.json` + web-ready assets |
| `scripts/render.mjs` | Chromium renders every frame deterministically, then ffmpeg muxes the voice-over, writes captions/poster/transcript, stamps MP4 chapter markers and cuts the 720p copy + GIF preview |
| `scripts/qa-show.mjs` | Off-frame / overflow / overlap audit at sampled times (fails the build loudly) |
| `scripts/render-still.mjs` | Renders the README screenshots that come from command output |

## Rebuilding

```bash
npm run dev -- -p 3210     # app against testnet, in another shell
npm run video:capture      # flows: home, faucet, connect, payment, contracts, admin, mobile, live
npm run video:build        # captures → timeline
npm run video:render       # ~4,200 frames @ 1080p30 + audio + chapters + variants
```

`capture.mjs` is safe to re-run: it reuses the demo keypair, re-funds through the
app's own faucet, and writes everything under `video/.work/` (gitignored — it holds
the throwaway secret key).

Outputs land in `public/video/`:

| File | Notes |
|------|-------|
| `stellardripz-pitch.mp4` | 1080p/30fps master, ~26 MB, 9 chapter markers |
| `stellardripz-pitch-720p.mp4` | 1280×720 companion for slow connections, ~8 MB |
| `stellardripz-pitch-preview.gif` | 7s animated preview (six beats), ~1.7 MB, for the README |
| `stellardripz-pitch-poster.jpg` | 1920×1080 end-card poster / hero thumbnail |
| `stellardripz-pitch.vtt` | WebVTT captions |

plus `video/transcript.md`. Rebuilding only the lighter variants:

```bash
npm run video:render -- --variants-only
```
