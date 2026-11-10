// Live moiré background, built on Moira's "Twin Wave" generator (jontoews.com/moira/).
//
// Two anchors, each with two sine-sum wave layers swept round a full turn, drawn the way Moira
// draws them (same seeded RNG, wave curves and alphas). Seed 772795 is the one in Jon's export;
// spacing, length, density and line weight were fitted by eye to that 12000px PNG.
//
// The motion engine: each layer is pre-rendered once to its own canvas, then every frame the
// four layers are composited with slow, independent transforms. Twisting one ring set against
// another by fractions of its 0.5° line pitch is what makes the moiré bands travel, so the
// circles animate internally. On top: the whole field turns (--moire-turn), anchor spacing and
// ring scales breathe, and every ~40 s one layer regrows with a new wave and crossfades in.
//
// Reads CSS variables (--moire-zoom, --moire-turn, --moire-x, --moire-motion, and the random
// --moire-delay/-flip/-dx/-dy set per page load). Static single frame for reduced motion.
(() => {
  "use strict";
  const host = document.querySelector(".moire");
  if (!host) return;
  const canvas = document.createElement("canvas");
  canvas.className = "moire__canvas";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // ------------------------------------------------------------ Moira's generator (ported)
  const SEED = 772795, SAMPLES = 110, DENSITY = 360, WEIGHT = 1.2, OPACITY = 0.55, INK = "#1c1b19";
  // fitted to Jon's export (ring radii and anchor spacing measured from the 12000px PNG)
  const P = { spacing: 13, length: 8, wildness: 1, layers: 2 };
  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  const runif = (rng, a, b) => a + (b - a) * rng();
  // genWave, in anchor-local coordinates
  function wave(rng, length, amp) {
    const a1 = runif(rng, 0.5, 2.0) * amp, a2 = runif(rng, 0.3, 1.5) * amp;
    const f2 = runif(rng, 0.5, 2.0), ph = runif(rng, 0, 2 * Math.PI);
    const pts = [];
    for (let i = 0; i < SAMPLES; i++) {
      const x = (length * i) / (SAMPLES - 1);
      pts.push([x, a1 * Math.sin(x) + a2 * Math.sin(f2 * x + ph)]);
    }
    return pts;
  }
  // twin-wave curves for both anchors, consuming the RNG in Moira's order
  function twinWave(seed, wildness = P.wildness) {
    const rng = mulberry32(seed), out = [];
    for (let a = 0; a < 2; a++)
      for (let i = 0; i < P.layers; i++)
        out.push({ anchor: a, layer: i, pts: wave(rng, Math.max(2, P.length - 2 * i), wildness),
                   alpha: Math.max(0.15, 0.6 - 0.1 * i) * OPACITY });
    return out;
  }
  const reach = (pts) => Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));

  // ------------------------------------------------------------ settings from CSS
  const S = {};
  function readVars() {
    const cs = getComputedStyle(document.documentElement), n = (k, d) => { const v = parseFloat(cs.getPropertyValue(k)); return isFinite(v) ? v : d; };
    S.zoom = n("--moire-zoom", 0.56); S.turn = n("--moire-turn", 900); S.x = n("--moire-x", 47) / 100;
    S.motion = n("--moire-motion", 1); S.delay = n("--moire-delay", 0); S.flip = n("--moire-flip", 1);
    S.dx = n("--moire-dx", 0); S.dy = n("--moire-dy", 0);
  }

  // ------------------------------------------------------------ geometry → screen
  // Matches the old image layer: image height = 253vmax × zoom / (12000/6728), and Moira fits the
  // bounding box into 86% of the frame height.
  let dpr = 1, W = 0, H = 0, unit = 1, imgW = 1, bboxH = 22;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr);
    canvas.width = W; canvas.height = H;
    const vmax = Math.max(innerWidth, innerHeight) / 100;
    const imgH = (253 * vmax * S.zoom) / (12000 / 6728) * dpr;
    imgW = imgH * (12000 / 6728);
    unit = (0.86 * imgH) / bboxH;            // device px per world unit
  }

  // ------------------------------------------------------------ layer buffers
  // Each layer = one curve swept DENSITY times, stroked as one path (as Moira groups it).
  const MAX = matchMedia("(max-width: 1023px)").matches ? 1400 : 2400;
  function makeBuffer(c) {
    const r = reach(c.pts) + 0.2;
    const k = Math.min(unit, MAX / (2 * r));  // buffer px per world unit (capped for memory)
    const size = Math.ceil(2 * r * k);
    const buf = document.createElement("canvas");
    buf.width = buf.height = size;
    return { c, r, k, buf, size, done: 0 };
  }
  function renderChunk(L, count) {
    const g = L.buf.getContext("2d"), base = new Path2D();
    L.c.pts.forEach(([x, y], i) => (i ? base.lineTo(x, y) : base.moveTo(x, y)));
    const path = new Path2D(), m = new DOMMatrix();
    const end = Math.min(DENSITY, L.done + count);
    for (let s = L.done; s < end; s++) path.addPath(base, m.rotate(0, 0, (s * 360) / DENSITY));
    g.setTransform(L.k, 0, 0, L.k, L.size / 2, L.size / 2);
    g.lineWidth = WEIGHT / unit;              // world units → 0.6 device px once composited on screen
    g.lineJoin = g.lineCap = "round";
    g.strokeStyle = INK; g.globalAlpha = L.c.alpha;
    g.stroke(path);
    L.done = end;
    return L.done >= DENSITY;
  }

  // ------------------------------------------------------------ motion engine
  const STEP = (2 * Math.PI) / DENSITY;        // angular line pitch: the moiré period
  // per-layer drift: [twist pitches per minute, breath depth, breath period s, phase]
  const DRIFT = [[0, 0, 1, 0], [1.6, 0.012, 71, 1.3], [-2.3, 0.018, 53, 0.4], [2.9, 0.022, 89, 2.2]];
  let layers = [], incoming = null, nextMorph = 0, seedCounter = SEED, t0 = performance.now(), clock = 0, last = t0;

  function build() {
    const curves = twinWave(SEED);
    bboxH = 2 * Math.max(...curves.map((c) => reach(c.pts)));
    layout();
    layers = curves.map(makeBuffer);
    layers.forEach((L) => renderChunk(L, DENSITY));
    incoming = null;
  }

  function morph(now) {
    // regrow one layer with a fresh wave (wildness wanders 0.75–1.35), keep its anchor and depth
    const i = 1 + Math.floor(Math.random() * 3);
    const old = layers[i].c;
    const rng = mulberry32(++seedCounter * 7919);
    const c = { ...old, pts: wave(rng, Math.max(2, P.length - 2 * old.layer), runif(rng, 0.75, 1.35)) };
    if (reach(c.pts) * 2 > bboxH * 1.08) return;    // keep the field inside its frame
    incoming = { i, L: makeBuffer(c), start: 0 };
    nextMorph = now + 40000 + Math.random() * 15000;
  }

  function drawLayer(L, d, t, alpha, sep) {
    const [rate, depth, period, phase] = DRIFT[d];
    const ax = (L.c.anchor ? 1 : -1) * (sep / 2) * unit;
    const twist = (rate / 60) * t * STEP;
    const breath = 1 + depth * Math.sin((2 * Math.PI * t) / period + phase);
    const s = (unit / L.k) * breath;
    ctx.save();
    ctx.translate(ax, 0);
    ctx.rotate(twist);
    ctx.scale(s, s);
    ctx.globalAlpha = alpha;
    ctx.drawImage(L.buf, -L.size / 2, -L.size / 2);
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(100, now - last); last = now;
    clock += (dt / 1000) * S.motion;               // internal motion runs on its own clock
    const t = clock;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const vmax = Math.max(innerWidth, innerHeight) / 100;
    ctx.translate(W / 2 + S.dx * vmax * dpr, H / 2 + S.dy * vmax * dpr);
    const turnT = (now - t0) / 1000 - S.delay;     // --moire-delay is negative: a random head start
    ctx.rotate((2 * Math.PI * turnT) / S.turn);
    ctx.scale(S.flip, 1);
    ctx.translate(-(S.x - 0.5) * imgW, 0);
    const sep = P.spacing * (1 + 0.1 * Math.sin((2 * Math.PI * t) / 137));
    layers.forEach((L, d) => {
      if (incoming && incoming.i === d && incoming.start) {
        const f = Math.min(1, (now - incoming.start) / 8000);
        drawLayer(L, d, t, 1 - f, sep);
        drawLayer(incoming.L, d, t, f, sep);
        if (f >= 1) { layers[d] = incoming.L; incoming = null; }
      } else drawLayer(L, d, t, 1, sep);
    });
    // build an incoming layer a slice at a time so no single frame stalls
    if (incoming && !incoming.start && renderChunk(incoming.L, 90)) incoming.start = now;
    if (!incoming && now > nextMorph) morph(now);
  }

  readVars(); build();
  nextMorph = performance.now() + 30000;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0;
  // the motion is slow, so ~30 fps is plenty and halves the work on high-refresh screens; phones get ~20 to save battery
  let drawn = 0;
  const gap = () => (innerWidth < 640 ? 48 : 32);
  const loop = (now) => { if (now - drawn >= gap()) { drawn = now; frame(now); } raf = requestAnimationFrame(loop); };
  const start = () => { cancelAnimationFrame(raf); last = performance.now(); if (still.matches) frame(last); else raf = requestAnimationFrame(loop); };
  start();
  still.addEventListener?.("change", start);
  document.addEventListener("visibilitychange", () => (document.hidden ? cancelAnimationFrame(raf) : start()));
  // rebuild on real resizes only: a phone's address bar showing or hiding while scrolling changes the height a little,
  // and rebuilding the layers mid-scroll would stutter (the canvas just stretches by that much instead)
  let rs, lastW = innerWidth, lastH = innerHeight;
  addEventListener("resize", () => {
    if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 160) return;
    lastW = innerWidth; lastH = innerHeight;
    clearTimeout(rs); rs = setTimeout(() => { readVars(); build(); start(); }, 200);
  });
})();
