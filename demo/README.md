# Demo Video

The recorded product pitch ships with the repository:

| | |
|---|---|
| **Video** | [`public/video/stellardripz-pitch.mp4`](../public/video/stellardripz-pitch.mp4) — 2:19, 1080p, 30fps |
| **Poster** | [`public/video/stellardripz-pitch-poster.jpg`](../public/video/stellardripz-pitch-poster.jpg) |
| **Captions** | [`public/video/stellardripz-pitch.vtt`](../public/video/stellardripz-pitch.vtt) |
| **Transcript** | [`video/transcript.md`](../video/transcript.md) |

Also embedded at the top of the [README](../README.md#-demo-video).

## Chapters

| Time | Chapter |
|------|---------|
| 0:00 | The Problem — the setup tax of building on Stellar |
| 0:13 | The Solution — one platform, five deployed Soroban contracts |
| 0:27 | Multi-Wallet Faucet — Freighter, xBull, Albedo, LOBSTR, WalletConnect |
| 0:45 | Payments + History — build → sign → submit, with explorer links |
| 0:59 | Soroban Smart Contracts — the guided wizard and a direct RPC read |
| 1:18 | Hybrid Architecture — direct reads, proxied writes |
| 1:36 | Built To Last — real test output and the CI pipeline |
| 1:52 | Live On Vercel — production deployment and `/api/health` |
| 2:03 | Get Started — open source, MIT licensed, ready to deploy |

## How it is made

Everything on screen is captured from the real app on Stellar testnet — the
faucet call, the payment, the contract calls and the deployed site — by an
automated Playwright harness; nothing is mocked except the wallet extension
itself (a local test double that signs with a throwaway keypair). The voice-over
is Gemini TTS, and the timeline is compiled from those captures plus real command
output, so the video can be rebuilt after a UI change:

```bash
npm run dev -- -p 3210      # app in another shell
npm run video:capture       # stills, clips, terminal artifacts  → video/.work
npm run video:build         # captures → timeline (video/.work/show.json)
npm run video:render        # frames + voice-over → public/video/stellardripz-pitch.mp4
```

The scene-by-scene narrative lives in [`video/script.json`](../video/script.json);
the geometry/authoring kit is [`video/scripts/lib/stagekit.mjs`](../video/scripts/lib/stagekit.mjs)
and the scene definitions are [`video/scripts/scenes.mjs`](../video/scripts/scenes.mjs).
