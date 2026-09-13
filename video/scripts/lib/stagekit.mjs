/**
 * Authoring kit for the pitch video.
 *
 * Everything here converts real capture data (stills + element bounding boxes,
 * clips, command output, live JSON) into keyframed layers for the stage. The
 * kit knows the geometry rules — most importantly how an element's box maps
 * onto the video frame once a still is zoomed — so the scenes stay readable.
 */

export const W = 1920;
export const H = 1080;
/** Logical viewport the app was captured at (stills are 2× this). */
export const VW = 1600;
export const VH = 900;

export const COLORS = {
  blue: "#3E63DD",
  blueLight: "#6B8AFF",
  purple: "#8B5CF6",
  purpleLight: "#A78BFA",
  green: "#10B981",
  orange: "#F59E0B",
  red: "#EF4444",
};

// ---- keyframe helpers ------------------------------------------------------

/** Opacity keys with eased-in/out holds. `t0`/`t1` are scene-local seconds. */
export function fade(t0, t1, { inDur = 0.45, outDur = 0.45, peak = 1, from = 0 } = {}) {
  const keys = [];
  keys.push([t0, from], [t0 + inDur, peak]);
  if (t1 - outDur > t0 + inDur) keys.push([t1 - outDur, peak]);
  keys.push([t1, 0]);
  return keys;
}

/** Slide-up entrance: y offset keys. */
export function rise(t0, { dur = 0.55, dy = 34 } = {}) {
  return [
    [t0, dy],
    [t0 + dur, 0],
  ];
}

/** Scale pop-in. */
export function pop(t0, { dur = 0.5, from = 0.94 } = {}) {
  return [
    [t0, from],
    [t0 + dur, 1],
  ];
}

/** Hold a value until `t1`, then keep it (used for long static holds). */
export function hold(t0, t1, value) {
  return [
    [t0, value],
    [t1, value],
  ];
}

// ---- kit -------------------------------------------------------------------

export function createKit({ manifest, artifacts = {}, stats = {} }) {
  const still = (name) => {
    const s = manifest.stills[name];
    if (!s) throw new Error(`unknown still: ${name}`);
    return s;
  };
  const clip = (name) => {
    const c = manifest.clips[name];
    if (!c) throw new Error(`unknown clip: ${name}`);
    return c;
  };
  const artifact = (name) => {
    const a = artifacts[name];
    if (!a) throw new Error(`unknown artifact: ${name}`);
    return a;
  };

  // ---- geometry ------------------------------------------------------------

  /**
   * Sample keyframes exactly like the stage does: smoothstep between keys.
   * Used so overlays that sit on top of an animated layer land in the same
   * place the stage will draw it.
   */
  function sampleKeys(keys, t) {
    if (!keys || keys.length === 0) return null;
    if (t <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (t >= last[0]) return last[1];
    for (let i = 1; i < keys.length; i += 1) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      if (t <= t1) {
        const p = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
        return v0 + (v1 - v0) * (p * p * (3 - 2 * p));
      }
    }
    return last[1];
  }

  /** Normalized center of a marked element inside its still. */
  function markCenter(stillName, markName) {
    const m = still(stillName).marks[markName];
    if (!m) throw new Error(`still ${stillName} has no mark ${markName}`);
    return {
      cx: (m.x + m.width / 2) / VW,
      cy: (m.y + m.height / 2) / VH,
      w: m.width / VW,
      h: m.height / VH,
    };
  }

  /**
   * Hard ceiling on how far a screenshot may be pushed in.
   *
   * Captures are 2× the logical viewport, so 1.0 already fills a 1080p frame
   * pixel-for-pixel; past roughly 2.6× the source starts to go soft on screen.
   * Clamping here (rather than hand-tuning every `fill`) keeps small UI
   * elements readable instead of turning them into upscaled mush, and pinning
   * the floor at 1.0 stops an image from shrinking inside its own frame and
   * exposing the background behind it.
   */
  const MAX_ZOOM = 2.6;

  /**
   * Zoom that makes a marked element fill `fill` of the frame's limiting axis.
   * Full-frame stills use the same aspect as the capture, so the two axes
   * scale identically and the smaller factor guarantees the whole element
   * stays visible.
   */
  function focusZoom(stillName, markName, fill = 0.72) {
    const m = markCenter(stillName, markName);
    return Math.min(MAX_ZOOM, Math.max(1, Math.min(fill / m.w, fill / m.h)));
  }

  /** Map a normalized point through a still's focus (zoom about the focus point). */
  function project(point, focus) {
    const fx = focus.cx * W;
    const fy = focus.cy * H;
    return {
      x: fx + (point.x * W - fx) * focus.z,
      y: fy + (point.y * H - fy) * focus.z,
    };
  }

  /** One focus keyframe set from a mark, with a slow push (drift) to `t1`. */
  function focusKeys(stillName, markName, { t0, t1, fill = 0.72, drift = 1.06, startFill = 0.82 } = {}) {
    const c = markCenter(stillName, markName);
    const z = focusZoom(stillName, markName, fill);
    // Keep the slow push inside the sharp range too.
    const clamp = (v) => Math.min(MAX_ZOOM, Math.max(1, v));
    return {
      cx: [
        [t0, c.cx],
        [t1, c.cx],
      ],
      cy: [
        [t0, c.cy],
        [t1, c.cy],
      ],
      z: [
        [t0, clamp(z * startFill)],
        [t1, clamp(z * drift)],
      ],
    };
  }

  /** Slow push across the whole frame (no specific mark). */
  function pushKeys({ t0, t1, from = 1.0, to = 1.07, cx = 0.5, cy = 0.5 } = {}) {
    return {
      cx: hold(t0, t1, cx),
      cy: hold(t0, t1, cy),
      z: [
        [t0, from],
        [t1, to],
      ],
    };
  }

  // ---- layer builders ------------------------------------------------------

  function stillLayer(stillName, options = {}) {
    const {
      t0,
      t1,
      mark = null,
      fill = 0.72,
      drift = 1.06,
      push = null,
      frame = null,
      radius = 18,
      rect = { x: 0, y: 0, w: W, h: H },
      from = 0,
      peak = 1,
      inDur = 0.5,
      outDur = 0.5,
      static: isStatic = false,
    } = options;
    const s = still(stillName);
    let focus = null;
    if (mark) focus = focusKeys(stillName, mark, { t0, t1, fill, drift });
    else if (push) focus = pushKeys({ t0, t1, ...push });
    return {
      type: "img",
      src: `/assets/${s.file.replace(/\.png$/, ".jpg")}`,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      radius,
      frame,
      focus,
      a: {
        opacity: isStatic ? [[t0, peak]] : fade(t0, t1, { inDur, outDur, from, peak }),
      },
    };
  }

  function clipLayer(clipName, options = {}) {
    const {
      t0,
      t1,
      startAt = 0, // seconds into the recorded clip
      rect = { x: 0, y: 0, w: W, h: H },
      radius = 18,
      frame = null,
      inDur = 0.4,
      outDur = 0.4,
      peak = 1,
    } = options;
    const c = clip(clipName);
    return {
      type: "clip",
      frames: c.frames.map((f) => ({ t: f.t, src: `/assets/${f.file}` })),
      fps: c.fps,
      clipStart: t0 - startAt,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      radius,
      frame,
      a: { opacity: fade(t0, t1, { inDur, outDur, peak }) },
    };
  }

  /**
   * Highlight box around a marked element, following the still's zoom.
   *
   * Pass `focus` (the `focus` keyframes of the `stillLayer` this spot sits on)
   * whenever the highlighted element is not the one the still is zoomed to —
   * otherwise the box is projected with the wrong zoom/centre and lands on top
   * of the wrong part of the screenshot.
   */
  function spot(stillName, markName, options = {}) {
    const { t0, t1, fill = 0.72, pad = 12, green = false, inDur = 0.35, from = 0, focus: focusKeys = null } = options;
    // Some marks belong to elements that are not always on screen when the
    // capture runs (a toast that has already auto-dismissed, a panel that
    // scrolled away). Degrade to an invisible box instead of failing the whole
    // render, and say so — the surrounding callout still carries the point.
    if (!still(stillName).marks?.[markName]) {
      console.warn(`  ⚠ spot skipped — ${stillName} has no mark ${markName}`);
      return { type: "box", cls: "spot", x: 0, y: 0, w: 0, h: 0, a: { opacity: [[t0, 0]] } };
    }
    const c = markCenter(stillName, markName);
    const focus = focusKeys
      ? {
          cx: sampleKeys(focusKeys.cx, (t0 + t1) / 2),
          cy: sampleKeys(focusKeys.cy, (t0 + t1) / 2),
          z: sampleKeys(focusKeys.z, (t0 + t1) / 2),
        }
      : { cx: c.cx, cy: c.cy, z: focusZoom(stillName, markName, fill) };
    const topLeft = project({ x: c.cx - c.w / 2, y: c.cy - c.h / 2 }, focus);
    const bottomRight = project({ x: c.cx + c.w / 2, y: c.cy + c.h / 2 }, focus);
    return {
      type: "box",
      cls: green ? "spot spot-green" : "spot",
      x: topLeft.x - pad,
      y: topLeft.y - pad,
      w: bottomRight.x - topLeft.x + pad * 2,
      h: bottomRight.y - topLeft.y + pad * 2,
      a: { opacity: fade(t0, t1, { inDur, outDur: 0.3, from }) },
    };
  }

  function text(value, options = {}) {
    const {
      t0,
      t1,
      x,
      y,
      w = null,
      style = "body",
      align = "left",
      color,
      html,
      dy = 28,
      inDur = 0.5,
      outDur = 0.45,
      ease = true,
    } = options;
    const layer = {
      type: "text",
      text: value,
      html,
      style,
      x,
      y,
      w,
      align,
      a: { opacity: fade(t0, t1, { inDur, outDur }) },
    };
    if (color) layer.color = color;
    if (ease) layer.a.y = rise(t0, { dur: 0.6, dy });
    return layer;
  }

  function chip(value, options = {}) {
    const { t0, t1, x, y, danger = false, inDur = 0.35, dy = 22 } = options;
    return {
      type: "box",
      cls: `chip${danger ? " chip-danger" : ""}`,
      x,
      y,
      a: { opacity: fade(t0, t1, { inDur, outDur: 0.3 }), y: rise(t0, { dur: 0.5, dy }) },
      __chipText: value,
    };
  }

  function callout(value, options = {}) {
    const { t0, t1, x, y, green = false, inDur = 0.35, dy = 16 } = options;
    return {
      type: "box",
      cls: `callout${green ? " callout-green" : ""}`,
      x,
      y,
      a: { opacity: fade(t0, t1, { inDur, outDur: 0.3 }), y: rise(t0, { dur: 0.45, dy }) },
      __chipText: value,
    };
  }

  function panel(artifactName, options = {}) {
    const {
      t0,
      t1,
      x,
      y,
      w,
      h = null,
      highlight = null,
      sweep = null,
      tight = false,
      inDur = 0.5,
      outDur = 0.5,
    } = options;
    const a = artifact(artifactName);
    const layer = {
      type: "panel",
      panel: {
        title: a.title,
        subtitle: a.subtitle,
        lines: a.lines || undefined,
        text: a.text || undefined,
        tight: tight || (a.lines && a.lines.length > 26),
        highlight,
      },
      x,
      y,
      w,
      h,
      a: { opacity: fade(t0, t1, { inDur, outDur }) },
    };
    if (sweep) layer.a.sweepSeries = sweep;
    return layer;
  }

  function diagram(spec, options = {}) {
    const { t0, t1, x = 0, y = 0, reveals = {}, edgeReveals = {}, inDur = 0.4 } = options;
    return {
      type: "diagram",
      diagram: spec,
      x,
      y,
      w: spec.width,
      h: spec.height,
      a: {
        opacity: fade(t0, t1, { inDur, outDur: 0.4 }),
        nodes: Object.fromEntries(
          Object.entries(reveals).map(([id, at]) => [
            id,
            [
              [at, 0],
              [at + 0.45, 1],
            ],
          ]),
        ),
        edges: Object.fromEntries(
          Object.entries(edgeReveals).map(([id, at]) => [
            id,
            [
              [at, 0],
              [at + 0.4, 1],
            ],
          ]),
        ),
      },
    };
  }

  /** Animated number + label, counted up between t0 and t0+dur. */
  function stat(value, label, options = {}) {
    const { t0, t1, x, y, suffix = "", dur = 1.1, color = null } = options;
    return {
      type: "text",
      text: "0",
      style: "stat",
      x,
      y,
      counter: { from: 0, suffix },
      color,
      label,
      a: {
        opacity: fade(t0, t1, { inDur: 0.4 }),
        count: [
          [t0, 0],
          [t0 + dur, value],
        ],
        y: rise(t0, { dur: 0.5, dy: 18 }),
      },
    };
  }

  /** Scrim (dimming overlay) used to push a screenshot into the background. */
  function scrim(options = {}) {
    const { t0, t1, from = 0, to = 0.72, inDur = 0.6, outDur = 0.6 } = options;
    return {
      type: "box",
      cls: "",
      x: 0,
      y: 0,
      w: W,
      h: H,
      css: "background:#020617",
      a: {
        opacity: [
          [t0, from],
          [t0 + inDur, to],
          [t1 - outDur, to],
          [t1, from],
        ],
      },
    };
  }

  /** Pulsing glow accent (deterministic pulse via keyframes). */
  function glow(options = {}) {
    const { t0, t1, x, y, size = 900, color = COLORS.blue, peak = 0.22, pulse = 3 } = options;
    const keys = [];
    const steps = Math.max(2, Math.round((t1 - t0) / (pulse / 2)));
    for (let i = 0; i <= steps; i += 1) {
      const time = t0 + (i / steps) * (t1 - t0);
      keys.push([time, i % 2 === 0 ? peak : peak * 0.45]);
    }
    return {
      type: "box",
      cls: "glow",
      x,
      y,
      w: size,
      h: size,
      css: `background:${color}`,
      a: { opacity: keys },
    };
  }

  function chapterLabel(value, { t0, t1 }) {
    return {
      type: "box",
      cls: "scene-label",
      x: 96,
      y: 84,
      css: "width:auto;height:auto",
      a: { opacity: fade(t0, t1, { inDur: 0.5, outDur: 0.5 }) },
      __html: `<span class="bar"></span><span class="txt2">${value}</span>`,
    };
  }

  /** The wordmark, optionally with the tagline. */
  function wordmark(options = {}) {
    const {
      t0,
      t1,
      x = 960,
      y = 420,
      size = 132,
      tagline = null,
      taglineY = null,
      align = "center",
    } = options;
    return {
      type: "text",
      html: `<span style="font-size:${size}px;font-weight:900;letter-spacing:-0.04em">Stellar<span class="grad">Dripz</span></span>${
        tagline
          ? `<div style="margin-top:${Math.round(size * 0.22)}px;font-size:34px;font-weight:500;color:rgba(255,255,255,0.6)">${tagline}</div>`
          : ""
      }`,
      style: "",
      x: align === "center" ? x - 700 : x,
      y,
      w: 1400,
      align,
      a: {
        opacity: fade(t0, t1, { inDur: 0.6 }),
        scale: pop(t0, { dur: 0.8, from: 0.965 }),
      },
    };
  }

  /** Contract / feature pill. */
  function pill(label, sub, options = {}) {
    const { t0, t1, x, y, w = 320, color = COLORS.blueLight, icon = null } = options;
    return {
      type: "box",
      cls: "",
      x,
      y,
      w,
      h: 96,
      css: `border-radius:20px;border:1px solid rgba(255,255,255,0.12);background:linear-gradient(160deg, rgba(30,41,59,0.9), rgba(15,23,42,0.8));box-shadow:0 24px 60px -30px rgba(0,0,0,0.9)`,
      a: { opacity: fade(t0, t1, { inDur: 0.4 }), y: rise(t0, { dur: 0.5, dy: 26 }) },
      __html: `<div style="display:flex;align-items:center;gap:14px;padding:0 20px;height:100%">
        ${icon ? `<span style="font-size:26px">${icon}</span>` : ""}
        <div>
          <div style="font-size:22px;font-weight:700;color:#fff">${label}</div>
          ${sub ? `<div style="font-family:'JetBrains Mono',monospace;font-size:13px;color:${color};opacity:0.85">${sub}</div>` : ""}
        </div>
      </div>`,
    };
  }

  return {
    manifest,
    artifacts,
    stats,
    still,
    clip,
    artifact,
    markCenter,
    focusZoom,
    project,
    sampleKeys,
    fade,
    rise,
    pop,
    hold,
    stillLayer,
    clipLayer,
    spot,
    text,
    chip,
    callout,
    panel,
    diagram,
    stat,
    scrim,
    glow,
    chapterLabel,
    wordmark,
    pill,
  };
}
