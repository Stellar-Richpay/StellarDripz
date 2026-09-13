/**
 * Deterministic animation engine for the pitch video.
 *
 * Every visual is a layer with keyframed numeric properties. `renderAt(t)`
 * writes the exact style for global time `t`, so frames are reproducible and
 * no browser clock (CSS animation, transition, video element) is involved.
 */

const STAGE = document.getElementById("stage");
const TRANSITION = 0.45; // seconds of crossfade between scenes

let SHOW = { scenes: [], duration: 0 };
const scenes = [];

// ---- math helpers ----------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (p) => p * p * (3 - 2 * p);

/** Piecewise-linear sample of `keys` ([[time, value], ...]) at time t. */
function sample(keys, t, ease = true) {
  if (!keys || keys.length === 0) return null;
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i += 1) {
    const [t0, v0] = keys[i - 1];
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const p = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (ease ? smooth(p) : p);
    }
  }
  return last[1];
}

/** Opacity fades are linear — smoothstep on a fade reads as a stutter. */
const sampleOpacity = (keys, t) => sample(keys, t, false);

// ---- layer construction ----------------------------------------------------

function el(tag, cls, parent) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (parent) parent.appendChild(node);
  return node;
}

function setBox(node, layer) {
  if (layer.x !== undefined) node.style.left = `${layer.x}px`;
  if (layer.y !== undefined) node.style.top = `${layer.y}px`;
  if (layer.w !== undefined) node.style.width = `${layer.w}px`;
  if (layer.h !== undefined) node.style.height = `${layer.h}px`;
  if (layer.css) node.style.cssText += layer.css;
}

function buildPanel(layer, parent) {
  const panel = layer.panel;
  const wrap = el("div", "layer panel", parent);
  setBox(wrap, layer);
  const bar = el("div", "panel-bar", wrap);
  const dots = el("div", "dots", bar);
  ["#ef4444", "#f59e0b", "#10b981"].forEach((color) => {
    const dot = el("div", "dot", dots);
    dot.style.background = color;
  });
  el("div", "panel-title", bar).textContent = panel.title || "";
  if (panel.subtitle) el("div", "panel-sub", bar).textContent = panel.subtitle;

  const body = el("div", `panel-body${panel.tight ? " tight" : ""}`, wrap);
  const rows = [];
  const lines = panel.lines || [];
  for (const line of lines) {
    const row = el("div", "row", body);
    if (line.n !== undefined) el("span", "ln", row).textContent = String(line.n);
    const code = el("span", "", row);
    if (line.tokens) {
      code.innerHTML = line.tokens
        .map((tok) => `<span class="tk-${tok.k}">${escapeHtml(tok.t)}</span>`)
        .join("");
    } else {
      code.textContent = line.text ?? "";
    }
    rows.push({ row, n: line.n });
  }
  if (panel.text !== undefined) {
    for (const raw of String(panel.text).split("\n")) {
      const row = el("div", `tline ${terminalClass(raw)}`, body);
      row.textContent = raw || " ";
      rows.push({ row });
    }
  }
  return { wrap, body, rows };
}

function terminalClass(line) {
  if (/^\s*(✓|√|ok\b|PASS|passed)/i.test(line)) return "t-ok";
  if (/(FAIL|✗|error\[|failed)/i.test(line)) return "t-bad";
  if (/^\s*(warning|⚠)/i.test(line)) return "t-warn";
  if (/^(Test Suites:|Tests:|Time:|Snapshots:)/.test(line)) return "t-bold";
  if (/^\s*(\$|>|#|running \d+ test|test result:)/.test(line)) return "t-dim";
  return "";
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildDiagram(layer, parent) {
  const spec = layer.diagram;
  const wrap = el("div", "layer diagram", parent);
  setBox(wrap, layer);
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const center = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

  const parts = [];
  for (const edge of spec.edges || []) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue;
    const ac = center(a);
    const bc = center(b);
    // Route between the facing sides: vertical when the boxes are stacked,
    // horizontal when they sit side by side.
    const vertical = Math.abs(bc.y - ac.y) > Math.abs(bc.x - ac.x) * 0.6;
    const p1 = vertical
      ? { x: ac.x, y: bc.y > ac.y ? a.y + a.h : a.y }
      : { x: bc.x > ac.x ? a.x + a.w : a.x, y: ac.y };
    const p2 = vertical
      ? { x: bc.x, y: bc.y > ac.y ? b.y : b.y + b.h }
      : { x: bc.x > ac.x ? b.x : b.x + b.w, y: bc.y };
    const mid = vertical ? (p1.y + p2.y) / 2 : (p1.x + p2.x) / 2;
    const d = vertical
      ? `M ${p1.x} ${p1.y} C ${p1.x} ${mid}, ${p2.x} ${mid}, ${p2.x} ${p2.y}`
      : `M ${p1.x} ${p1.y} C ${mid} ${p1.y}, ${mid} ${p2.y}, ${p2.x} ${p2.y}`;
    const cls = `dedge${edge.accent ? " accent" : ""}${edge.flow ? " flow" : ""}`;
    parts.push(
      `<path class="${cls}" data-edge="${edge.from}>${edge.to}" d="${d}" marker-end="url(#arrow${edge.accent ? "A" : ""})"/>`,
    );
    if (edge.label) {
      const lx = vertical ? p1.x + 16 : mid;
      const ly = vertical ? mid + 6 : (p1.y + p2.y) / 2 - 12;
      parts.push(
        `<text class="dlabel" x="${lx}" y="${ly}">${escapeHtml(edge.label)}</text>`,
      );
    }
  }

  for (const node of spec.nodes) {
    parts.push(
      `<g class="dnode ${node.kind || ""}" data-node="${node.id}">` +
        `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="16"/>` +
        `<text x="${node.x + node.w / 2}" y="${node.y + (node.sub ? node.h / 2 - 4 : node.h / 2 + 8)}" text-anchor="middle">${escapeHtml(node.label)}</text>` +
        (node.sub
          ? `<text class="sub" x="${node.x + node.w / 2}" y="${node.y + node.h / 2 + 26}" text-anchor="middle">${escapeHtml(node.sub)}</text>`
          : "") +
        `</g>`,
    );
  }

  wrap.innerHTML =
    `<svg width="${spec.width || 1800}" height="${spec.height || 800}" viewBox="0 0 ${spec.width || 1800} ${spec.height || 800}">` +
    `<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="9" refY="5" orient="auto">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="rgba(148,163,184,0.6)"/></marker>` +
    `<marker id="arrowA" markerWidth="12" markerHeight="12" refX="9" refY="5" orient="auto">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="rgba(107,138,255,0.9)"/></marker></defs>` +
    parts.join("") +
    `</svg>`;

  return {
    wrap,
    nodeEls: [...wrap.querySelectorAll(".dnode")],
    edgeEls: [...wrap.querySelectorAll(".dedge")],
  };
}

function createLayer(layer, parent) {
  if (layer.type === "panel") {
    const built = buildPanel(layer, parent);
    return { def: layer, el: built.wrap, body: built.body, rows: built.rows, kind: "panel" };
  }
  if (layer.type === "diagram") {
    const built = buildDiagram(layer, parent);
    return {
      def: layer,
      el: built.wrap,
      nodeEls: built.nodeEls,
      edgeEls: built.edgeEls,
      kind: "diagram",
    };
  }
  if (layer.type === "img" || layer.type === "clip") {
    const wrap = el("div", "layer imgwrap", parent);
    setBox(wrap, layer);
    wrap.style.borderRadius = `${layer.radius ?? 20}px`;

    let container = wrap;
    if (layer.frame) {
      const chrome = el("div", "chrome", wrap);
      const dots = el("div", "dots", chrome);
      ["#ef4444", "#f59e0b", "#10b981"].forEach((color) => {
        const dot = el("div", "dot", dots);
        dot.style.background = color;
      });
      el("div", "chrome-title", chrome).textContent = layer.frame.title || "";
      if (layer.frame.url) el("div", "chrome-url", chrome).textContent = layer.frame.url;
      const inner = el("div", "", wrap);
      inner.style.cssText =
        "position:absolute;left:0;right:0;top:44px;bottom:0;overflow:hidden;border-radius:0 0 " +
        `${layer.radius ?? 20}px ${layer.radius ?? 20}px`;
      container = inner;
    }

    const img = el("img", "", container);
    img.decoding = "async";
    img.style.cssText =
      "width:100%;height:100%;object-fit:cover;object-position:center;" +
      "transform-origin:center;display:block";
    if (layer.type === "img") img.src = layer.src;
    if (!layer.frame) {
      el("div", "frame", wrap).style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.08)";
    }
    return { def: layer, el: wrap, img, kind: "img", framed: Boolean(layer.frame) };
  }
  if (layer.type === "text") {
    const node = el("div", `layer txt ${layer.style || "body"}`, parent);
    setBox(node, layer);
    if (layer.align) node.style.textAlign = layer.align;
    if (layer.color) node.style.color = layer.color;
    if (layer.html) node.innerHTML = layer.html;
    else node.textContent = layer.text || "";
    return { def: layer, el: node, kind: "text", base: layer.text };
  }
  // solid / box / glow / chip / callout — plain styled div
  const node = el("div", `layer ${layer.type === "box" ? "box" : ""}`, parent);
  setBox(node, layer);
  if (layer.cls) node.className = `layer ${layer.cls}`;
  if (layer.__html) node.innerHTML = layer.__html;
  else if (layer.__chipText !== undefined) node.textContent = layer.__chipText;
  else if (layer.text) node.textContent = layer.text;
  return { def: layer, el: node, kind: layer.type };
}

// ---- scene assembly --------------------------------------------------------

function buildScene(def) {
  const container = el("div", "scene", STAGE);
  const layerNodes = (def.layers || []).map((layer) => createLayer(layer, container));
  // Preload clip frames so scrubbing never blocks on a decode.
  for (const node of layerNodes) {
    if (node.def.type === "clip") {
      for (const frame of node.def.frames) {
        const pre = new Image();
        pre.src = frame.src;
      }
    }
  }
  return { def, container, layerNodes, clipIndex: new Map() };
}

// ---- per-frame rendering ---------------------------------------------------

function applyLayer(node, t) {
  const { def, el: nodeEl } = node;
  const a = def.a || {};

  const opacity = sampleOpacity(a.opacity, t) ?? 1;
  if (opacity <= 0.001) {
    nodeEl.style.display = "none";
    return;
  }
  nodeEl.style.display = "";

  const x = sample(a.x, t);
  const y = sample(a.y, t);
  const scale = sample(a.scale, t);
  let transform = "";
  if (isNum(x)) transform += `translate(${x}px, ${isNum(y) ? y : 0}px) `;
  else if (isNum(y)) transform += `translate(0px, ${y}px) `;
  if (isNum(scale)) transform += `scale(${scale})`;
  nodeEl.style.transform = transform.trim() || "none";
  nodeEl.style.opacity = String(opacity);
  if (a.blur) {
    const blur = sample(a.blur, t);
    nodeEl.style.filter = `blur(${blur}px)`;
  }

  if (node.kind === "img") {
    const focus = def.focus;
    if (focus) {
      const cx = sample(focus.cx, t) ?? 0.5;
      const cy = sample(focus.cy, t) ?? 0.5;
      const z = sample(focus.z, t) ?? 1;
      node.img.style.objectPosition = `${cx * 100}% ${cy * 100}%`;
      node.img.style.transformOrigin = `${cx * 100}% ${cy * 100}%`;
      node.img.style.transform = `scale(${z})`;
    }
    if (def.type === "clip") {
      const clipT = t - (def.clipStart || 0);
      const idx = Math.max(
        0,
        Math.min(def.frames.length - 1, Math.floor(clipT * (def.fps || 12))),
      );
      if (node.clipIndex !== idx) {
        node.img.src = def.frames[idx].src;
        node.clipIndex = idx;
      }
    }
  }

  if (node.kind === "text" && node.base !== undefined && def.counter) {
    const value = sample(a.count, t) ?? def.counter.from;
    nodeEl.textContent = `${Math.round(value).toLocaleString("en-US")}${def.counter.suffix || ""}`;
  }

  if (node.kind === "panel") {
    if (a.scroll) {
      const offset = sample(a.scroll, t) ?? 0;
      node.body.style.transform = `translateY(${-offset}px)`;
    }
    if (a.sweepSeries) {
      const lineNo = sample(a.sweepSeries, t);
      for (const row of node.rows) {
        const hit = row.n !== undefined && Math.abs(row.n - lineNo) < 1;
        row.row.classList.toggle("sweep", Boolean(hit));
      }
    }
    if (def.highlight) {
      for (const row of node.rows) {
        if (row.n !== undefined && def.highlight.includes(row.n)) row.row.classList.add("hl");
      }
    }
  }

  if (node.kind === "diagram") {
    const reveal = a.nodes || {};
    for (const nodeEl of node.nodeEls) {
      const keys = reveal[nodeEl.dataset.node];
      const value = keys ? sampleOpacity(keys, t) ?? 1 : 1;
      nodeEl.style.opacity = String(value);
    }
    const edgeReveal = a.edges || {};
    for (const edgeEl of node.edgeEls) {
      const id = edgeEl.dataset.edge;
      const keys = edgeReveal[id];
      const value = keys ? sampleOpacity(keys, t) ?? 1 : 1;
      edgeEl.style.opacity = String(value);
      if (def.diagram.flowDash) {
        const phase = sampleOpacity([[0, 0], [def.duration || 30, -260]], t) ?? 0;
        edgeEl.style.strokeDashoffset = String(phase);
      }
    }
  }
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function renderAt(t) {
  for (const scene of scenes) {
    const { def } = scene;
    const local = t - def.start;
    let opacity = 1;
    if (local < 0) {
      opacity = local > -TRANSITION ? 1 + local / TRANSITION : 0;
    } else if (local > def.duration) {
      opacity = local < def.duration + TRANSITION ? 1 - (local - def.duration) / TRANSITION : 0;
    }
    if (opacity <= 0.001) {
      if (scene.container.style.display !== "none") scene.container.style.display = "none";
      continue;
    }
    scene.container.style.display = "";
    scene.container.style.opacity = String(opacity);
    // A gentle settle: incoming scenes ease up from 1.5% over-scale.
    const entry = local < 0 ? 0 : clamp(local / (TRANSITION * 1.6), 0, 1);
    const settle = 1.015 - 0.015 * smooth(entry);
    scene.container.style.transform = `scale(${settle})`;
    const clampedLocal = clamp(local, 0, def.duration);
    for (const node of scene.layerNodes) applyLayer(node, clampedLocal);
  }

  // Global progress bar.
  const progress = document.getElementById("progress");
  if (progress) progress.style.width = `${clamp(t / SHOW.duration, 0, 1) * 1920}px`;
}

// ---- boot ------------------------------------------------------------------

async function boot() {
  const res = await fetch("/show.json");
  SHOW = await res.json();
  document.title = SHOW.title || "StellarDripz";

  const bg = document.getElementById("bg");
  for (const layer of SHOW.background || []) createLayer(layer, bg);

  for (const def of SHOW.scenes) scenes.push(buildScene(def));

  const progress = el("div", "progress", STAGE);
  progress.id = "progress";

  await document.fonts.ready;
  window.__duration = SHOW.duration;
  window.__render = renderAt;
  window.__ready = true;
}

boot().catch((err) => {
  document.getElementById("bg").textContent = `stage failed: ${err.message}`;
  window.__error = String(err.stack || err.message);
});
