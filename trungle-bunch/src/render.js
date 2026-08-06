import { TAU, clamp, lerp, hexToRgb, rgba, wobble, smoothstep } from './util.js';
import { vertices, edgeMid, edgeNormal } from './triangle.js';
import {
  STEPS,
  HALO,
  CARBON,
  CANVAS,
  edgeHex,
  ground,
  groundChannel,
  step,
} from './palette.js';

const HOVER_R = 210;

// Fritz forbids smooth grades, so every ramp in here is drawn as hard-edged
// equal bands. BANDS is the dial — raise for a finer read, drop for blockier.
const BANDS = STEPS;

const rgbCache = new Map();
function rgb(hex) {
  let v = rgbCache.get(hex);
  if (!v) {
    v = hexToRgb(hex);
    rgbCache.set(hex, v);
  }
  return v;
}

export class Renderer {
  constructor(canvas, net) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.net = net;
    this.dpr = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.w = w;
    this.h = h;
    this.net.resize(w, h);
    this.buildSpeckle();
  }

  // Spore dust, drawn once. Grain is a texture, not a softening.
  buildSpeckle() {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const g = c.getContext('2d');
    const n = Math.round((this.w * this.h) / 2600);
    const halo = rgb(HALO[1]);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * this.w;
      const y = Math.random() * this.h;
      const r = Math.random() < 0.14 ? 1.3 : 0.6;
      g.fillStyle = rgba(halo, 0.02 + Math.random() * 0.07);
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    this.speckle = c;
  }

  draw() {
    const g = this.ctx;
    const net = this.net;
    const t = net.time;
    const gr = ground(net.spirit);
    const thread = rgb(HALO[4]);
    const pulse = rgb(HALO[0]);

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = CANVAS;
    g.fillRect(0, 0, this.w, this.h);

    this.drawSubstrate(g, gr, t);
    this.drawField(g, t);

    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.7;
    g.drawImage(this.speckle, 0, 0);
    g.globalAlpha = 1;
    this.drawHyphae(g, thread, t);
    this.drawThreads(g, thread, pulse, t);
    this.drawPulses(g, pulse);
    g.globalCompositeOperation = 'source-over';

    const sorted = [...net.tris].sort((a, b) => a.z - b.z);
    for (const tri of sorted) this.drawTriangle(g, tri, t);

    this.drawCursor(g, thread, t);
  }

  /**
   * The substrate: concentric hard-edged bands in whichever channel rung the
   * gravity axis has stepped to. Sweeping vertically snaps the world between
   * discrete states rather than sliding through them.
   */
  drawSubstrate(g, gr, t) {
    const c = rgb(gr.hex);
    const lift = this.net.spirit * this.h * 0.17;
    const maxR = Math.max(this.w, this.h) * 0.62;
    // two centres only — three sets of contours cancel each other's edges and
    // the banding stops reading as banding
    for (let i = 0; i < 2; i++) {
      const cx = this.w * (0.36 + 0.26 * i) + wobble(i * 3.1, t * 0.06) * this.w * 0.18;
      const cy = this.h * (0.66 - 0.17 * i) - lift + wobble(i * 7.7 + 2, t * 0.05) * this.h * 0.16;
      const r0 = maxR * (1 - i * 0.14);
      for (let k = BANDS - 1; k >= 0; k--) {
        const r = (r0 * (k + 1)) / BANDS;
        // equal steps — the ramp comes from bands stacking, so every boundary
        // between them stays a hard edge
        const a = gr.a * 0.13 * (1 - i * 0.22);
        g.fillStyle = rgba(c, a);
        g.beginPath();
        g.arc(cx, cy, r, 0, TAU);
        g.fill();
      }
    }
  }

  // The fifth axis as parallel streaks along the field direction, dashed so
  // their drift rate shows the fourth. Tinted by whichever channel owns the
  // ground — never a blend between two.
  drawField(g, t) {
    const net = this.net;
    const ch = groundChannel(net.spirit);
    const c = rgb(ch === CARBON ? HALO[4] : ch[1]);
    const a = net.gravityAngle;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const L = Math.hypot(this.w, this.h);
    const spacing = 58;
    const count = Math.ceil(L / spacing);
    const cx = this.w / 2;
    const cy = this.h / 2;

    g.save();
    g.strokeStyle = rgba(c, 0.05 + step(Math.abs(net.spirit)) * 0.09);
    g.lineWidth = 1;
    g.setLineDash([2, 26]);
    g.lineDashOffset = -t * net.flow * 46;
    g.beginPath();
    for (let k = -count; k <= count; k++) {
      const ox = cx + -dy * k * spacing;
      const oy = cy + dx * k * spacing;
      g.moveTo(ox - dx * L, oy - dy * L);
      g.lineTo(ox + dx * L, oy + dy * L);
    }
    g.stroke();
    g.restore();
  }

  drawHyphae(g, thread, t) {
    g.lineCap = 'round';
    for (const tri of this.net.tris) {
      if (tri.grow < 0.4) continue;
      for (let i = 0; i < 3; i++) {
        if (tri.edges[i].conn) continue;
        const m = edgeMid(tri, i);
        const n = edgeNormal(tri, i);
        for (let k = 0; k < 2; k++) {
          const sd = tri.seed + i * 9 + k * 31;
          const spread = (k - 0.5) * 0.5;
          const len = (16 + 30 * (0.5 + 0.5 * wobble(sd, t * 0.4))) * (1 - k * 0.35);
          const bend = wobble(sd * 1.7, t * 0.7) * 0.75 + spread;
          const a1 = n + bend * 0.35;
          const a2 = n + bend;
          g.strokeStyle = rgba(thread, 0.11 - k * 0.045);
          g.lineWidth = 0.9 - k * 0.3;
          g.beginPath();
          g.moveTo(m.x, m.y);
          g.quadraticCurveTo(
            m.x + Math.cos(a1) * len * 0.55,
            m.y + Math.sin(a1) * len * 0.55,
            m.x + Math.cos(a2) * len,
            m.y + Math.sin(a2) * len
          );
          g.stroke();
        }
      }
    }
  }

  threadPath(c, t) {
    const [a, b] = c.ends();
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // the slack goes out of a thread as it is stretched — it pulls taut
    const taut = 1 / (1 + (c.tension || 0) * 2.4);
    const sag = wobble(c.seed, t * 0.5) * (14 + 38 * (1 - c.strength)) * taut;
    return { a, b, len, cx: mx + (-dy / len) * sag, cy: my + (dx / len) * sag };
  }

  pointOn(path, u) {
    const iu = 1 - u;
    return {
      x: iu * iu * path.a.x + 2 * iu * u * path.cx + u * u * path.b.x,
      y: iu * iu * path.a.y + 2 * iu * u * path.cy + u * u * path.b.y,
    };
  }

  tracePath(g, path) {
    g.beginPath();
    g.moveTo(path.a.x, path.a.y);
    g.quadraticCurveTo(path.cx, path.cy, path.b.x, path.b.y);
  }

  /** Exact de Casteljau split at u=0.5, so each half keeps the same curve. */
  traceHalf(g, path, second) {
    const m = this.pointOn(path, 0.5);
    if (!second) {
      g.beginPath();
      g.moveTo(path.a.x, path.a.y);
      g.quadraticCurveTo((path.a.x + path.cx) / 2, (path.a.y + path.cy) / 2, m.x, m.y);
    } else {
      g.beginPath();
      g.moveTo(m.x, m.y);
      g.quadraticCurveTo((path.cx + path.b.x) / 2, (path.cy + path.b.y) / 2, path.b.x, path.b.y);
    }
  }

  drawThreads(g, thread, pulse, t) {
    g.lineCap = 'round';
    for (const c of this.net.conns) {
      const path = this.threadPath(c, t);
      c._path = path;

      if (!c.alive) {
        const u = smoothstep(c.progress);
        const tip = this.pointOn(path, u);
        g.strokeStyle = rgba(thread, 0.09 + c.affinity * 0.13);
        g.lineWidth = 0.85;
        g.beginPath();
        g.moveTo(path.a.x, path.a.y);
        g.quadraticCurveTo(lerp(path.a.x, path.cx, u), lerp(path.a.y, path.cy, u), tip.x, tip.y);
        g.stroke();
        g.fillStyle = rgba(pulse, 0.3);
        g.beginPath();
        g.arc(tip.x, tip.y, 1.5, 0, TAU);
        g.fill();
        continue;
      }

      // strength read as a stepped rung, not a continuous thickness
      const s = step(c.strength);
      g.strokeStyle = rgba(thread, 0.02 + s * 0.045);
      g.lineWidth = 2 + s * 6;
      this.tracePath(g, path);
      g.stroke();

      // Each half of the thread carries the channel of the edge it holds, with a
      // hard cut at the midpoint. This is the colour COMBINATION made visible —
      // the pair of channels a thread joins is what decides both bodies' voices.
      const hexA = edgeHex(c.a.edgeCents(c.ai), c.a.edges[c.ai].energy, false);
      const hexB = edgeHex(c.b.edgeCents(c.bi), c.b.edges[c.bi].energy, false);
      g.lineWidth = 0.9 + s * 1.5;
      g.strokeStyle = hexA;
      g.globalAlpha = 0.32 + s * 0.5;
      this.traceHalf(g, path, false);
      g.stroke();
      g.strokeStyle = hexB;
      this.traceHalf(g, path, true);
      g.stroke();
      g.globalAlpha = 1;

      g.strokeStyle = rgba(pulse, 0.02 + s * 0.05);
      g.lineWidth = 0.5 + s * 1.6;
      g.setLineDash([1.5, 7 + s * 9]);
      g.lineDashOffset = c.seed;
      this.tracePath(g, path);
      g.stroke();
      g.setLineDash([]);

      // a thread under load lights up along its length
      const tn = c.tension || 0;
      if (tn > 0.12) {
        g.strokeStyle = rgba(pulse, Math.min(0.34, tn * 0.3) * s);
        g.lineWidth = 0.6;
        this.tracePath(g, path);
        g.stroke();
      }

      // grip — the tendril flares where it holds the edge, and digs in harder
      // the more it is being stretched
      const grip = 1.1 + s * 2 + tn * 1.6;
      g.fillStyle = rgba(thread, 0.1 + s * 0.26 + tn * 0.12);
      g.beginPath();
      g.arc(path.a.x, path.a.y, grip, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(path.b.x, path.b.y, grip, 0, TAU);
      g.fill();

      if (c.strain > 0.5) {
        g.strokeStyle = rgba(pulse, 0.05 * (c.strain - 0.5));
        g.lineWidth = 0.6;
        g.setLineDash([1, 5]);
        this.tracePath(g, path);
        g.stroke();
        g.setLineDash([]);
      }
    }
  }

  drawPulses(g, pulse) {
    for (const pl of this.net.pulses) {
      const path = pl.conn._path;
      if (!path) continue;
      const u = pl.dir > 0 ? pl.pos : 1 - pl.pos;
      const here = this.pointOn(path, clamp(u, 0, 1));
      const back = this.pointOn(path, clamp(u - pl.dir * 0.09, 0, 1));

      const a = clamp(pl.amp, 0, 1);
      g.strokeStyle = rgba(pulse, a * 0.45);
      g.lineWidth = 1 + a * 2.2;
      g.beginPath();
      g.moveTo(back.x, back.y);
      g.lineTo(here.x, here.y);
      g.stroke();

      g.fillStyle = rgba(pulse, a * 0.8);
      g.beginPath();
      g.arc(here.x, here.y, 1.3 + a * 2.6, 0, TAU);
      g.fill();

      // two hard rings instead of a feathered halo
      for (let k = 1; k <= 2; k++) {
        g.strokeStyle = rgba(pulse, (a * 0.16) / k);
        g.lineWidth = 1;
        g.beginPath();
        g.arc(here.x, here.y, 3 + k * (2 + a * 5), 0, TAU);
        g.stroke();
      }
    }
  }

  drawTriangle(g, tri, t) {
    const scale = tri.scale();
    const fade = tri.grow * (1 - tri.dying);
    if (fade <= 0.001) return;
    const alpha = fade * lerp(1, 0.5, step(clamp(Math.abs(tri.z), 0, 1)));
    const rr = tri.radius() * scale;

    const shiver = tri.attention * 2.4 + tri.energy * 1.1 + tri.impact * 3.2;
    const pts = vertices(tri).map((v, i) => ({
      x: tri.x + (v.x - tri.x) * scale + wobble(tri.seed + i * 5, t * 9) * shiver,
      y: tri.y + (v.y - tri.y) * scale + wobble(tri.seed + i * 5 + 50, t * 9) * shiver,
    }));

    // Edges bow when the body is soft and straighten as it tempers — the
    // waveform morph made visible.
    const slack = 1 - step(tri.temper);
    const bows = [];
    for (let i = 0; i < 3; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 3];
      const n = edgeNormal(tri, i);
      const amt =
        (2.2 + 2.6 * tri.bow[i]) * slack * (1 + 0.28 * wobble(tri.seed + i * 3, t * 0.35));
      bows.push({
        a,
        b,
        cx: (a.x + b.x) / 2 + Math.cos(n) * amt,
        cy: (a.y + b.y) / 2 + Math.sin(n) * amt,
      });
    }

    const body = new Path2D();
    body.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < 3; i++)
      body.quadraticCurveTo(bows[i].cx, bows[i].cy, bows[i].b.x, bows[i].b.y);
    body.closePath();

    // flat cap fill at a stepped alpha
    const nodeCol = rgb(HALO[3]);
    g.fillStyle = rgba(nodeCol, (0.03 + step(clamp(tri.energy, 0, 1)) * 0.1) * alpha);
    g.fill(body);

    // Hit and bounce: hard bands sweeping across the body from the side it was
    // struck on, in the channel of whichever edge took the blow.
    if (tri.impact > 0.02) this.shadeImpact(g, tri, body, rr, alpha);

    // a struck body throws stepped shock rings rather than a soft glow
    if (tri.energy > 0.06) {
      const e = step(clamp(tri.energy, 0, 1));
      g.save();
      g.globalCompositeOperation = 'lighter';
      const col = rgb(edgeHex(tri.edgeCents(tri.activeEdge), tri.energy, true));
      for (let k = 1; k <= 3; k++) {
        g.strokeStyle = rgba(col, ((e * 0.2) / k) * alpha);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(tri.x, tri.y, rr * (1 + k * 0.28), 0, TAU);
        g.stroke();
      }
      g.restore();
    }

    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const e = tri.edges[i];
      const bw = bows[i];
      const active = i === tri.activeEdge;
      const lit = clamp(e.energy, 0, 1.4);
      const col = edgeHex(tri.edgeCents(i), lit, active);

      const stroke = () => {
        g.beginPath();
        g.moveTo(bw.a.x, bw.a.y);
        g.quadraticCurveTo(bw.cx, bw.cy, bw.b.x, bw.b.y);
        g.stroke();
      };

      if (lit > 0.04 || active) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = col;
        g.globalAlpha = (step(lit) * 0.26 + (active ? 0.08 : 0)) * alpha;
        g.lineWidth = 5 + step(lit) * 12;
        stroke();
        g.restore();
      }

      g.strokeStyle = col;
      g.globalAlpha = alpha * (active ? 0.95 : 0.5 + step(lit) * 0.4);
      // a tempered body draws a harder, heavier line
      g.lineWidth = (active ? 2 : 1.05) + step(lit) * 2.2 + step(tri.temper) * 0.9;
      stroke();
      g.globalAlpha = 1;

      if (Math.abs(e.cents) > 1.5) {
        const m = { x: (bw.a.x + bw.b.x) / 2, y: (bw.a.y + bw.b.y) / 2 };
        const n = edgeNormal(tri, i);
        const off = clamp(e.cents / 95, -1, 1);
        const len = 4 + Math.abs(off) * 9;
        const ang = n + off * 0.9;
        g.strokeStyle = col;
        g.globalAlpha = alpha * (0.32 + Math.abs(off) * 0.45);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(m.x, m.y);
        g.lineTo(m.x + Math.cos(ang) * len, m.y + Math.sin(ang) * len);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    // Corners reveal themselves as the cursor comes near, so the shape gesture is
    // discoverable without putting handles on screen permanently.
    const m = this.net.mouse;
    if (m.inside) {
      for (let i = 0; i < 3; i++) {
        const v = pts[i];
        const d = Math.hypot(m.x - v.x, m.y - v.y);
        if (d > 90) continue;
        const near = 1 - d / 90;
        const col = rgb(edgeHex(tri.edgeCents(i), 0.5, false));
        g.strokeStyle = rgba(col, near * near * 0.55 * alpha);
        g.lineWidth = 1.1;
        g.beginPath();
        g.arc(v.x, v.y, 3 + near * 2.6, 0, TAU);
        g.stroke();
      }
    }

    // spore core — flat, stepped, and in the body's own channel so it belongs
    const frac = step(clamp(tri.nutrient / tri.threshold, 0, 1));
    const cr = rr * (0.05 + 0.09 * frac);
    if (cr > 0.8) {
      const coreCol = rgb(edgeHex(tri.edgeCents(tri.activeEdge), 0.6, true));
      g.fillStyle = rgba(coreCol, (0.1 + frac * 0.22 + step(tri.energy) * 0.26) * alpha);
      g.beginPath();
      g.arc(tri.x, tri.y, cr, 0, TAU);
      g.fill();
    }
  }

  /**
   * Directional shading from a collision: BANDS hard-edged slabs marching in
   * from the struck side, clipped to the body. No gradient anywhere in it.
   */
  shadeImpact(g, tri, body, rr, alpha) {
    const m = clamp(tri.impact, 0, 1.4);
    const struck = tri.nearestEdgeToAngle(tri.impactAngle);
    const col = rgb(edgeHex(tri.edgeCents(struck), 1, true));

    const dx = Math.cos(tri.impactAngle);
    const dy = Math.sin(tri.impactAngle);
    // start at the rim on the struck side and step inward across the body
    const x0 = tri.x + dx * rr * 1.25;
    const y0 = tri.y + dy * rr * 1.25;
    const span = (rr * 2.5) / BANDS;

    g.save();
    g.clip(body);
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < BANDS; k++) {
      const a = m * 0.24 * (1 - k / BANDS) * alpha;
      if (a < 0.004) continue;
      const cx = x0 - dx * span * (k + 0.5);
      const cy = y0 - dy * span * (k + 0.5);
      g.save();
      g.translate(cx, cy);
      g.rotate(tri.impactAngle);
      g.fillStyle = rgba(col, a);
      g.fillRect(-span / 2, -rr * 1.6, span, rr * 3.2);
      g.restore();
    }
    g.restore();
  }

  drawCursor(g, thread, t) {
    const m = this.net.mouse;
    if (!m.inside) return;
    g.save();
    g.strokeStyle = rgba(thread, 0.05);
    g.lineWidth = 1;
    g.setLineDash([3, 14]);
    g.lineDashOffset = t * 12;
    g.beginPath();
    g.arc(m.x, m.y, HOVER_R, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = rgba(thread, 0.1);
    g.beginPath();
    g.arc(m.x, m.y, 5, 0, TAU);
    g.stroke();
    g.restore();
  }
}
