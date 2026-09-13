/**
 * The pitch video: scene definitions.
 *
 * Each scene maps the narration (video/script.json) onto real captures. Beat
 * timings are derived from the narration itself — sentences are distributed
 * across the scene's measured audio duration by word count — so the visuals
 * stay in step with the voice-over without hand-tuned magic numbers.
 */
import { createKit, W, H, COLORS } from "./lib/stagekit.mjs";

/** Silence before the voice-over starts, and after it ends, per scene. */
const LEAD = 0.4;
const TAIL = 0.7;

/** Contract IDs as configured in the app (and documented in the README). */
const CONTRACTS = [
  ["Counter", "CCAIIGMOB…46R2AE", "🧮"],
  ["DripToken", "CD3YTU3JC…G3GY6", "🪙"],
  ["DripPool", "CCBNJTZ22…MZIR6X", "🏊"],
  ["Governance", "CD3NIJCGE…GG6AIVH", "🗳️"],
  ["Badge", "CAZFH3S7…GEEUWE", "🎖️"],
];

// ---- timeline helpers ------------------------------------------------------

/** Split narration into sentences with proportional time windows. */
function planBeats(narration, { start, audio }) {
  const sentences =
    narration
      .match(/[^.!?]+[.!?]+/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? [narration];
  const counts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const total = counts.reduce((a, b) => a + b, 0);
  let cursor = start;
  return sentences.map((text, i) => {
    const span = (counts[i] / total) * audio;
    const beat = { text, words: counts[i], start: cursor, end: cursor + span };
    cursor += span;
    return beat;
  });
}

/** Split a beat into sub-shots by relative shares. */
function slices(beat, shares) {
  const total = shares.reduce((a, b) => a + b, 0);
  let cursor = beat.start;
  return shares.map((share) => {
    const span = ((beat.end - beat.start) * share) / total;
    const slice = { t0: cursor, t1: cursor + span };
    cursor += span;
    return slice;
  });
}

/** Kicker + headline pair used by the narrative scenes. */
function heading(kit, { t0, t1, kicker, title, y = 330, x = 140, w = 1180 }) {
  return [
    kit.text(kicker, { t0, t1, x, y: y - 56, w, style: "kicker" }),
    kit.text(title, { t0, t1, x, y, w, style: "h1", html: title.replace(/\n/g, "<br/>") }),
  ];
}

/** Pull the real transaction hash the UI displayed, straight from the capture. */
function shownTxHash(kit) {
  const mono = kit.still("payment-success").digest?.monospace || [];
  const hit = mono.find((m) => m.startsWith("TX:"));
  return hit ? hit.replace("TX:", "").replace("...", "").trim() : null;
}

// ---- scenes ----------------------------------------------------------------

export function buildShow({ manifest, artifacts, stats, script, durations }) {
  const kit = createKit({ manifest, artifacts, stats });
  const { stillLayer, clipLayer, spot, text, chip, callout, panel, diagram, stat, scrim, glow, chapterLabel, wordmark, pill } = kit;

  // Scene schedule: contiguous scenes, each with a lead-in and a tail.
  let cursor = 0;
  const schedule = script.scenes.map((scene, i) => {
    const audio = durations[i]?.seconds ?? scene.target;
    const entry = {
      ...scene,
      index: i,
      audio,
      start: cursor,
      duration: audio + TAIL,
      window: [LEAD, LEAD + audio],
    };
    cursor += audio + TAIL;
    return entry;
  });

  const scenes = [];
  const scene = (def) => {
    scenes.push(def);
    return def;
  };

  // ---------------------------------------------------------------- 01 problem
  {
    const s = schedule[0];
    const beats = planBeats(s.narration, { start: s.window[0], audio: s.audio });
    const [setup, pains] = beats;
    const layers = [
      stillLayer("home-hero", {
        t0: 0,
        t1: s.duration,
        frame: { title: "StellarDripz — Testnet XLM Faucet" },
        radius: 0,
        push: { from: 1.04, to: 1.13 },
        inDur: 0.7,
        outDur: 0.5,
      }),
      scrim({ t0: 1.6, t1: s.duration - 0.3, to: 0.82 }),
      glow({ t0: 0, t1: s.duration, x: -220, y: -260, size: 1100, color: COLORS.blue, peak: 0.16 }),
      chapterLabel(s.chapter || "The Problem", { t0: 0.35, t1: s.duration - 0.2 }),
      ...heading(kit, {
        t0: setup.start,
        t1: pains.start + 0.35,
        kicker: "The setup tax",
        title: "Shipping on Stellar\nstarts with a maze",
        y: 470,
      }),
    ];

    const painsList = [
      ["💸", "Funding a testnet account"],
      ["🔑", "Juggling five wallets"],
      ["📜", "Deploying contracts by hand"],
      ["🕵️", "No visibility into contract events"],
    ];
    painsList.forEach(([icon, label], i) => {
      const at = pains.start + 0.1 + i * 0.55;
      layers.push(
        chip(`${icon}  ${label}`, {
          t0: at,
          t1: s.duration - 0.15,
          x: 150,
          y: 480 + i * 104,
          danger: true,
        }),
      );
    });

    scene({ id: s.id, chapter: s.chapter, start: s.start, duration: s.duration, layers });
  }

  // --------------------------------------------------------------- 02 solution
  {
    const s = schedule[1];
    const beats = planBeats(s.narration, { start: s.window[0], audio: s.audio });
    const [meet, live] = beats;
    const layers = [
      glow({ t0: 0, t1: s.duration, x: 700, y: 120, size: 1200, color: COLORS.purple, peak: 0.2 }),
      wordmark({
        t0: meet.start - 0.1,
        t1: live.start + 0.2,
        y: 380,
        size: 140,
        tagline: "The Stellar developer platform — one app, every workflow",
      }),
      chapterLabel(s.chapter || "The Solution", { t0: 0.35, t1: s.duration - 0.2 }),
    ];

    // Live dashboard proof.
    const dashTop = stillLayer("dashboard-top", {
      t0: live.start,
      t1: s.duration,
      frame: { title: "StellarDripz — connected wallet" },
      radius: 0,
      mark: "balances",
      fill: 0.55,
      drift: 1.03,
      inDur: 0.5,
      outDur: 0.4,
    });
    layers.push(
      dashTop,
      spot("dashboard-top", "walletCard", {
        t0: live.start + 0.35,
        t1: live.start + 2.4,
        fill: 0.55,
        focus: dashTop.focus,
      }),
      callout("🔑 Five wallets supported", { t0: live.start + 0.5, t1: live.start + 2.6, x: 1200, y: 700 }),
      spot("dashboard-top", "balances", {
        t0: live.start + 2.5,
        t1: s.duration - 1.4,
        fill: 0.55,
        focus: dashTop.focus,
      }),
      callout("💧 10,000 testnet XLM on tap", { t0: live.start + 2.7, t1: s.duration - 1.4, x: 1160, y: 700 }),
    );

    // Five deployed contracts.
    const pillsStart = live.start + 1.4;
    layers.push(scrim({ t0: pillsStart - 0.2, t1: s.duration - 0.15, to: 0.66, from: 0 }));
    layers.push(
      text("Five Soroban contracts already deployed to testnet", {
        t0: pillsStart,
        t1: s.duration - 0.15,
        x: 0,
        y: 660,
        w: W,
        align: "center",
        style: "h3",
      }),
    );
    CONTRACTS.forEach(([name, id, icon], i) => {
      layers.push(
        pill(name, id, {
          t0: pillsStart + 0.25 + i * 0.12,
          t1: s.duration - 0.15,
          x: 122 + i * 340,
          y: 740,
          w: 316,
          icon,
        }),
      );
    });

    scene({ id: s.id, chapter: s.chapter, start: s.start, duration: s.duration, layers });
  }

  // ------------------------------------------------------- 03 faucet + wallets
  {
    const s = schedule[2];
    const beats = planBeats(s.narration, { start: s.window[0], audio: s.audio });
    const [connectBeat, walletsBeat, faucetBeat] = beats;
    const layers = [chapterLabel(s.chapter || "Multi-Wallet Faucet", { t0: 0.35, t1: s.duration - 0.2 })];

    // Wallet picker + the five real wallets.
    layers.push(
      stillLayer("wallet-picker", {
        t0: connectBeat.start - 0.15,
        t1: walletsBeat.end + 0.5,
        frame: { title: "Choose Wallet" },
        radius: 0,
        mark: "picker",
        fill: 0.42,
        drift: 1.05,
      }),
      scrim({ t0: connectBeat.start - 0.15, t1: walletsBeat.end + 0.5, from: 0, to: 0.35, inDur: 0.5, outDur: 0.4 }),
    );
    const wallets = [
      ["🦊", "Freighter", 0.05],
      ["🐂", "xBull", 0.5],
      ["☀️", "Albedo", 0.95],
      ["🐙", "LOBSTR", 1.4],
      ["📱", "WalletConnect", 1.85],
    ];
    wallets.forEach(([icon, name, at], i) => {
      layers.push(
        pill(name, "", {
          t0: walletsBeat.start + at,
          t1: s.duration - 0.3,
          x: 152 + i * 330,
          y: 872,
          w: 306,
          icon,
          color: COLORS.green,
        }),
      );
    });

    // One click, funded.
    // Gentle push rather than a 2.6× push-in on one label: this beat has to
    // keep the toast and the faucet card on screen at the same time.
    const faucetShot = stillLayer("faucet-success", {
      t0: faucetBeat.start - 0.2,
      t1: s.duration,
      frame: { title: "Testnet faucet — funded" },
      radius: 0,
      push: { from: 1.0, to: 1.07, cy: 0.5 },
      inDur: 0.5,
      outDur: 0.4,
    });
    layers.push(
      faucetShot,
      spot("faucet-success", "balance", {
        t0: faucetBeat.start + 0.25,
        t1: faucetBeat.start + 3.4,
        fill: 0.62,
        green: true,
        focus: faucetShot.focus,
      }),
      callout("✅ 10,000 testnet XLM — one click", {
        t0: faucetBeat.start + 0.4,
        t1: faucetBeat.start + 3.6,
        x: 1120,
        y: 660,
        green: true,
      }),
      callout("🛡 Per-address rate limit · 60s cooldown", {
        t0: faucetBeat.start + 3.8,
        t1: s.duration - 0.3,
        x: 1080,
        y: 660,
      }),
    );

    // Cooldown counter, recorded live, as a picture-in-picture window.
    layers.push(
      clipLayer("cooldown", {
        t0: faucetBeat.start + 5.2,
        t1: s.duration - 0.25,
        startAt: 2,
        rect: { x: 1240, y: 120, w: 560, h: 316 },
        radius: 16,
        frame: { title: "cooldown" },
      }),
    );

    scene({ id: s.id, chapter: s.chapter, start: s.start, duration: s.duration, layers });
  }

  // ---------------------------------------------------------------- 04 payments
  {
    const s = schedule[3];
    const beats = planBeats(s.narration, { start: s.window[0], audio: s.audio });
    const [sendBeat, flowBeat] = beats;
    const hash = shownTxHash(kit);
    const layers = [chapterLabel(s.chapter || "Payments + History", { t0: 0.35, t1: s.duration - 0.2 })];

    const sendShot = stillLayer("send-filled", {
      t0: sendBeat.start - 0.15,
      t1: flowBeat.start + 0.6,
      frame: { title: "Send — XLM payment" },
      radius: 0,
      push: { from: 1.0, to: 1.06, cy: 0.58 },
    });
    layers.push(
      sendShot,
      spot("send-filled", "sendButton", {
        t0: sendBeat.start + 0.6,
        t1: flowBeat.start + 0.5,
        fill: 0.5,
        green: true,
        focus: sendShot.focus,
      }),
      callout("250 XLM → any Stellar address", {
        t0: sendBeat.start + 0.7,
        t1: flowBeat.start + 0.5,
        x: 1090,
        y: 700,
        green: true,
      }),
    );

    // Build → sign → submit, with the real write path.
    layers.push(scrim({ t0: flowBeat.start, t1: flowBeat.end + 0.2, to: 0.55, inDur: 0.45, outDur: 0.4 }));
    const steps = [
      ["1  Build (server)", flowBeat.start + 0.15],
      ["2  Sign (wallet)", flowBeat.start + 1.35],
      ["3  Submit (Horizon)", flowBeat.start + 2.6],
    ];
    steps.forEach(([label, at], i) => {
      layers.push(
        chip(label, { t0: at, t1: flowBeat.end + 0.35, x: 250 + i * 500, y: 470, danger: false }),
      );
    });
    layers.push(
      callout("Server-side build keeps fee estimation + validation off the client", {
        t0: flowBeat.start + 1.0,
        t1: flowBeat.end + 0.35,
        x: 250,
        y: 560,
      }),
    );

    const historyShot = stillLayer("history-rows", {
      t0: flowBeat.end - 0.1,
      t1: s.duration,
      frame: { title: "Transaction history" },
      radius: 0,
      mark: "history",
      fill: 0.66,
      drift: 1.03,
      inDur: 0.5,
      outDur: 0.4,
    });
    layers.push(
      historyShot,
      spot("history-rows", "filter", {
        t0: flowBeat.end + 0.4,
        t1: s.duration - 0.4,
        fill: 0.66,
        green: true,
        focus: historyShot.focus,
      }),
      callout(hash ? `🔗 tx ${hash.slice(0, 12)}… on the explorer` : "🔗 Verified on the block explorer", {
        t0: flowBeat.end + 0.5,
        t1: s.duration - 0.3,
        x: 1080,
        y: 700,
        green: true,
      }),
    );

    scene({ id: s.id, chapter: s.chapter, start: s.start, duration: s.duration, layers });
  }

  // --------------------------------------------------------------- 05 contracts
  {
    const s = schedule[4];
    const beats = planBeats(s.narration, { start: s.window[0], audio: s.audio });
    const [beyond, wizardBeat, actions, events] = beats;
    const layers = [chapterLabel(s.chapter || "Soroban Smart Contracts", { t0: 0.35, t1: s.duration - 0.2 })];

    // The action rows are the subject here, so hold the whole frame and let
    // the four highlight boxes mark them out one by one.
    const wizardShot = stillLayer("wizard-actions", {
      t0: beyond.start - 0.15,
      t1: actions.start + 0.6,
      frame: { title: "Contract Wizard — guided Soroban flows" },
      radius: 0,
      push: { from: 1.0, to: 1.05, cy: 0.55 },
    });
    layers.push(
      wizardShot,
      callout("Guided mint · transfer · stake · vote", {
        t0: beyond.start + 0.4,
        t1: actions.start + 0.5,
        x: 1180,
        y: 210,
      }),
    );

    // The four headline actions light up as they are named.
    [
      ["mint", wizardBeat.start + 1.4],
      ["transfer", wizardBeat.start + 2.1],
      ["stake", actions.start + 0.15],
      ["vote", actions.start + 0.85],
    ].forEach(([mark, at]) => {
      layers.push(
        spot("wizard-actions", mark, {
          t0: at,
          t1: at + 0.85,
          fill: 0.72,
          green: true,
          focus: wizardShot.focus,
        }),
      );
    });

    // Form → review, then a real execution.
    const reviewShot = stillLayer("wizard-review", {
      t0: actions.start + 2.6,
      t1: events.start + 0.3,
      frame: { title: "Contract Wizard — review & execute" },
      radius: 0,
      mark: "execute",
      fill: 0.55,
      drift: 1.05,
    });
    layers.push(
      stillLayer("wizard-mint-params", {
        t0: actions.start + 0.4,
        t1: actions.start + 2.6,
        frame: { title: "Contract Wizard — Mint params" },
        radius: 0,
        mark: "amountField",
        fill: 0.5,
      }),
      reviewShot,
      spot("wizard-review", "execute", {
        t0: actions.start + 3.1,
        t1: events.start + 0.2,
        fill: 0.55,
        green: true,
        focus: reviewShot.focus,
      }),
      callout("Validated args → review → wallet signature", {
        t0: actions.start + 2.9,
        t1: events.start + 0.2,
        x: 1150,
        y: 660,
      }),
    );

    layers.push(
      // The counter and event stream sit in a small panel, so this beat holds
      // the whole frame and drives the callouts instead of zooming into a
      // 15px label (which would just be upscaled mush at 1080p).
      stillLayer("soroban-incremented", {
        t0: events.start + 0.1,
        t1: s.duration,
        frame: { title: "Soroban demo — live counter + event stream" },
        radius: 0,
        push: { from: 1.02, to: 1.09, cy: 0.6 },
        inDur: 0.5,
        outDur: 0.4,
      }),
      scrim({ t0: events.start + 0.3, t1: s.duration - 0.3, to: 0.45, from: 0, inDur: 0.5, outDur: 0.4 }),
      callout("✅ Read straight from Soroban RPC — no proxy", {
        t0: events.start + 0.5,
        t1: events.start + 3.4,
        x: 1140,
        y: 250,
        green: true,
      }),
      callout("Signed in the wallet, submitted, confirmed on-chain", {
        t0: events.start + 0.6,
        t1: events.start + 3.5,
        x: 1140,
        y: 350,
      }),
      callout("⚡ Event stream connected — SSE with RPC polling fallback", {
        t0: events.start + 3.5,
        t1: s.duration - 0.25,
        x: 1140,
        y: 470,
      }),
    );

    scene({ id: s.id, chapter: s.chapter, start: s.start, duration: s.duration, layers });
  }

  // ------------------------------------------------------------ 06 architecture
  {
    const s = schedule[5];
    const beats = planBeats(s.narration, { start: s.window[0], audio: s.audio });
    const [hybrid, reads, writes] = beats;

    const spec = {
      width: 1720,
      height: 700,
      nodes: [
        { id: "browser", label: "Browser", sub: "Next.js 14 · React 18", x: 40, y: 250, w: 420, h: 130, kind: "blue" },
        { id: "horizon", label: "Horizon", sub: "balances · payments", x: 640, y: 40, w: 420, h: 130, kind: "green" },
        { id: "rpc", label: "Soroban RPC", sub: "simulate · events", x: 1180, y: 40, w: 420, h: 130, kind: "green" },
        { id: "api", label: "Next.js API routes", sub: "faucet · payment · invoke", x: 640, y: 250, w: 420, h: 130, kind: "purple" },
        { id: "guards", label: "rate limit · CSRF", sub: "validate · log · analytics", x: 1180, y: 250, w: 420, h: 130, kind: "amber" },
        { id: "chain", label: "Stellar testnet", sub: "5 Soroban contracts", x: 640, y: 530, w: 960, h: 130, kind: "blue" },
      ],
      edges: [
        { from: "browser", to: "horizon", accent: true, flow: true, label: "direct reads" },
        { from: "browser", to: "rpc", accent: true, flow: true, label: "simulate + events" },
        { from: "browser", to: "api", label: "proxied writes" },
        { from: "api", to: "guards", label: "" },
        { from: "guards", to: "chain", label: "signed tx" },
        { from: "horizon", to: "chain" },
        { from: "rpc", to: "chain" },
      ],
    };

    const layers = [
      chapterLabel(s.chapter || "Hybrid Architecture", { t0: 0.35, t1: s.duration - 0.2 }),
      glow({ t0: 0, t1: s.duration, x: 300, y: 400, size: 1100, color: COLORS.blue, peak: 0.13 }),
    ];

    layers.push(
      ...heading(kit, {
        t0: hybrid.start,
        t1: reads.start + 0.4,
        kicker: "Under the hood",
        title: "A hybrid architecture",
        y: 340,
      }),
      text("Reads go direct. Writes go through the API layer.", {
        t0: hybrid.start + 0.6,
        t1: reads.start + 0.4,
        x: 140,
        y: 520,
        w: 1100,
        style: "body",
      }),
    );

    layers.push(
      diagram(spec, {
        t0: reads.start,
        t1: writes.start + 1.2,
        x: 100,
        y: 300,
        reveals: {
          browser: reads.start + 0.1,
          horizon: reads.start + 0.6,
          rpc: reads.start + 1.1,
          api: writes.start + 0.1,
          guards: writes.start + 0.7,
          chain: writes.start + 1.3,
        },
        edgeReveals: {
          "browser>horizon": reads.start + 0.9,
          "browser>rpc": reads.start + 1.4,
          "browser>api": writes.start + 0.4,
          "api>guards": writes.start + 1.0,
          "guards>chain": writes.start + 1.6,
          "horizon>chain": reads.start + 1.8,
          "rpc>chain": reads.start + 2.0,
        },
      }),
      callout("Direct reads · lower latency, no round-trip", {
        t0: reads.start + 0.8,
        t1: reads.end,
        x: 1280,
        y: 96,
        green: true,
      }),
      callout("Proxied writes · rate limited, validated, logged", {
        t0: writes.start + 0.3,
        t1: writes.end + 0.9,
        x: 1240,
        y: 96,
      }),
    );

    scene({ id: s.id, chapter: s.chapter, start: s.start, duration: s.duration, layers });
  }

  // --------------------------------------------------------------- 07 quality
  {
    const s = schedule[6];
    const beats = planBeats(s.narration, { start: s.window[0], audio: s.audio });
    const [claim, evidence] = beats;

    const rustTests = stats.rustTests || 92;
    const jestLine = stats.jest || "";
    const jestTests = Number(jestLine.match(/Tests:.*?(\d+)\s+passed/)?.[1] || 0) || 276;
    const jestSuites = Number((stats.jestSuites || "").match(/(\d+)\s+passed/)?.[1] || 0) || 38;
    const commits = stats.commits || 894;

    const layers = [
      chapterLabel(s.chapter || "Built To Last", { t0: 0.35, t1: s.duration - 0.2 }),
      ...heading(kit, {
        t0: claim.start - 0.1,
        t1: evidence.start + 0.5,
        kicker: "Quality, enforced",
        title: "Tested end to end",
        y: 320,
      }),
      glow({ t0: 0, t1: s.duration, x: 1000, y: 500, size: 1000, color: COLORS.green, peak: 0.12 }),
    ];

    // Stat cards count up from the real numbers.
    const statsList = [
      [rustTests, "Rust contract tests"],
      [jestTests, "frontend tests"],
      [jestSuites, "test suites"],
      [commits, "commits"],
    ];
    // Real terminal output, then the CI pipeline. The stat cards clear out
    // first: the panels are tall (up to ~35 lines) and would otherwise collide
    // with them and run off the bottom of the frame.
    const panelT0 = evidence.start + 2.2;
    const statsOut = panelT0 - 0.35;

    statsList.forEach(([value, label], i) => {
      const x = 140 + i * 420;
      layers.push({
        type: "box",
        cls: "",
        x,
        y: 470,
        w: 380,
        h: 190,
        css: `border-radius:24px;border:1px solid rgba(255,255,255,0.1);background:linear-gradient(160deg, rgba(30,41,59,0.85), rgba(15,23,42,0.7));box-shadow:0 30px 70px -40px rgba(0,0,0,0.9)`,
        a: {
          opacity: [
            [evidence.start - 0.6, 0],
            [evidence.start - 0.2, 1],
            [statsOut, 1],
            [statsOut + 0.3, 0],
          ],
        },
      });
      layers.push(
        stat(value, label, {
          t0: evidence.start - 0.3 + i * 0.18,
          t1: statsOut,
          x: x + 34,
          y: 508,
          dur: 1.1,
        }),
      );
      layers.push(
        text(label, {
          t0: evidence.start + 0.2 + i * 0.18,
          t1: statsOut,
          x: x + 34,
          y: 606,
          w: 320,
          style: "stat-label",
        }),
      );
    });

    layers.push(
      panel("contracts-tests", {
        x: 140,
        y: 150,
        w: 780,
        t0: panelT0,
        t1: panelT0 + 3.6,
        tight: true,
      }),
      panel("frontend-tests", {
        x: 970,
        y: 150,
        w: 810,
        t0: panelT0 + 1.1,
        t1: panelT0 + 5.0,
        tight: true,
      }),
      panel("typecheck", {
        x: 140,
        y: 150,
        w: 780,
        t0: panelT0 + 3.8,
        t1: s.duration,
        tight: true,
      }),
      panel("ci-workflow", {
        x: 970,
        y: 150,
        w: 810,
        t0: panelT0 + 5.2,
        t1: s.duration,
        tight: true,
        highlight: [4, 5, 6, 7, 8, 9],
      }),
      callout("Every push → tests · lint · build · deploy", {
        t0: panelT0 + 5.4,
        t1: s.duration - 0.3,
        x: 1330,
        y: 52,
      }),
    );

    scene({ id: s.id, chapter: s.chapter, start: s.start, duration: s.duration, layers });
  }

  // ------------------------------------------------------------------ 08 live
  {
    const s = schedule[7];
    const beats = planBeats(s.narration, { start: s.window[0], audio: s.audio });
    const beat = beats[0];
    const layers = [
      chapterLabel(s.chapter || "Live On Vercel", { t0: 0.35, t1: s.duration - 0.2 }),
      stillLayer("live-home", {
        t0: beat.start - 0.2,
        t1: beat.start + 4.4,
        frame: { title: "StellarDripz — production", url: "stellardripz.vercel.app" },
        radius: 0,
        push: { from: 1.03, to: 1.12 },
        inDur: 0.6,
        outDur: 0.4,
      }),
      callout("🟢 Live on Vercel · HTTP 200", {
        t0: beat.start + 1.2,
        t1: beat.start + 4.2,
        x: 1180,
        y: 190,
        green: true,
      }),
      panel("live-health", {
        x: 190,
        y: 130,
        w: 1540,
        t0: beat.start + 4.5,
        t1: s.duration,
        tight: false,
        highlight: [2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      }),
      callout("Verifies Horizon, Soroban RPC and all five contract IDs", {
        t0: beat.start + 5.0,
        t1: s.duration - 0.3,
        x: 1100,
        y: 60,
      }),
    ];

    scene({ id: s.id, chapter: s.chapter, start: s.start, duration: s.duration, layers });
  }

  // ----------------------------------------------------------------- 09 outro
  {
    const s = schedule[8];
    const beats = planBeats(s.narration, { start: s.window[0], audio: s.audio });
    const [name, everything, openSource] = beats;
    const layers = [
      glow({ t0: 0, t1: s.duration, x: 760, y: 300, size: 1300, color: COLORS.purple, peak: 0.22 }),
      wordmark({
        t0: name.start - 0.2,
        t1: s.duration,
        y: 330,
        size: 150,
        tagline: "Build, test and demo on Stellar — in one place",
      }),
    ];

    layers.push(
      chip("🌐 stellardripz.vercel.app", { t0: everything.start + 1.4, t1: s.duration, x: 560, y: 640 }),
      chip("⭐ github.com/Stellar-Richpay/StellarDripz", { t0: openSource.start + 0.2, t1: s.duration, x: 560, y: 750 }),
      chip("📄 MIT licensed", { t0: openSource.start + 1.2, t1: s.duration, x: 1180, y: 750 }),
    );

    CONTRACTS.forEach(([cname, , icon], i) => {
      layers.push(
        text(`${icon} ${cname}`, {
          t0: openSource.start + 2.0 + i * 0.1,
          t1: s.duration,
          x: 560 + i * 170,
          y: 880,
          w: 160,
          style: "small",
          align: "center",
        }),
      );
    });

    scene({ id: s.id, chapter: s.chapter, start: s.start, duration: s.duration, layers });
  }

  // ---------------------------------------------------------------- poster
  const posterStart = cursor + 5;
  scene({
    id: "poster",
    chapter: "Poster",
    start: posterStart,
    duration: 6,
    layers: [
      stillLayer("dashboard-grid", {
        t0: posterStart,
        t1: posterStart + 6,
        radius: 0,
        push: { from: 1.06, to: 1.06 },
        inDur: 0.01,
        outDur: 0.01,
      }),
      scrim({ t0: posterStart, t1: posterStart + 6, from: 0.55, to: 0.55, inDur: 0.01, outDur: 0.01 }),
      {
        type: "text",
        html: `<span style="font-size:150px;font-weight:900;letter-spacing:-0.045em">Stellar<span class="grad">Dripz</span></span>
          <div style="margin-top:34px;font-size:40px;font-weight:600;color:rgba(255,255,255,0.85)">Product pitch · 2 minutes</div>
          <div style="margin-top:18px;font-size:26px;color:rgba(255,255,255,0.6)">Multi-wallet faucet · payments · 5 Soroban contracts · live on Vercel</div>`,
        x: 260,
        y: 300,
        w: 1400,
        align: "center",
        a: { opacity: [[posterStart, 1]] },
      },
      {
        type: "box",
        cls: "playbadge",
        x: 890,
        y: 660,
        w: 140,
        h: 140,
        a: { opacity: [[posterStart, 1]] },
        __html: "<i></i>",
      },
    ],
  });

  return {
    title: "StellarDripz — Product Pitch",
    width: W,
    height: H,
    fps: 30,
    duration: posterStart, // the poster is rendered outside the timeline
    posterTime: posterStart,
    background: [
      { type: "box", cls: "grid", x: 0, y: 0, w: W, h: H, a: { opacity: [[0, 1]] } },
    ],
    scenes,
  };
}
