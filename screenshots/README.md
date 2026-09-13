# Screenshots

Every image here is generated from the real app, not hand-drawn: the UI shots
come from the automated capture harness (`video/scripts/capture.mjs`) driving the
app against Stellar testnet, and the terminal/workflow shots are composed from
verbatim command output collected by `video/scripts/collect-artifacts.mjs`.

| File | What it shows | Source |
|------|---------------|--------|
| `wallet-connect.png` | Multi-wallet picker (Freighter, xBull, Albedo, LOBSTR, WalletConnect) | live app capture |
| `soroban-demo.png` | Direct Soroban RPC read of the deployed counter | live app capture |
| `mobile-responsive.png` | The app at a 390×844 mobile viewport | live app capture |
| `admin-dashboard.png` | `/admin` analytics fed by real usage | live app capture |
| `live-deployment.png` | The production app on Vercel | [stellardripz.vercel.app](https://stellardripz.vercel.app) |
| `ci-cd-pipeline.png` | The GitHub Actions workflow definition, highlighted | `.github/workflows/ci-cd.yml` |
| `test-output.png` | `cargo test` and `npm test` summaries | real command output |

## Regenerating

```bash
npm run dev -- -p 3210       # app in another shell
npm run video:capture        # refreshes the UI screenshots + manifest
npm run video:stills         # re-renders ci-cd-pipeline.png / test-output.png
```

The same captures are what the [product pitch video](../public/video/stellardripz-pitch.mp4)
is cut from — see [`video/`](../video) for the pipeline.
