// The contour view.
//
// The third reading. Frequency and time make a plane, loudness makes a height,
// and the result is surveyed rather than plotted: iso-lines joining points of
// equal energy, the way a map joins points of equal altitude. Quiet places read
// as open ground; a sustained tone reads as a long ridge running down the sheet;
// a transient reads as a closed island.
//
// All four places are drawn into the same rectangle in their own inks. Two places
// holding the same frequency at the same moment produce contours that nest into
// each other — the chord, arrived at by the drawing rather than annotated onto it.
//
// Marching squares, on a field blurred first. Contouring an unblurred spectrogram
// gives a thicket of noise-islands; the blur is what turns it into landscape.
//
// Everything here is continuous in time, which took four separate decisions and
// is the difference between a survey and a flicker. The sheet scrolls by the
// fraction of a frame that has elapsed rather than by whole rows; each grid row is
// the mean of the frames it spans rather than one sampled frame; the height field
// eases toward its new value rather than being replaced; and each contour is
// chained into a whole polyline and cut smooth rather than drawn as loose
// segments. See CONFIG.contour for what each one is worth.

import { CONFIG } from '../core/config.js';
import { clamp, easeCoefficient } from '../core/util.js';

const PAPER = '#f2f0eb';

export class Contour {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('2D canvas is required for the contour view.');
    // One eased height field per channel, kept between frames. A single shared
    // scratch field could not be eased: channel four would inherit channel one's
    // landscape and every place would smear into the next.
    this.fields = new Map();
    this.sinceMs = 0;   // render time accumulated since the last re-trace
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return [w, h];
  }

  /** This channel's field, allocated on first sight and reallocated if the grid changes. */
  fieldFor(channel, cols, rows) {
    let store = this.fields.get(channel.id);
    if (!store || store.cols !== cols || store.rows !== rows) {
      store = {
        cols, rows,
        field: new Float32Array(cols * rows),
        target: new Float32Array(cols * rows),
        scratch: new Float32Array(cols * rows),
        primed: false,
        head: -1,      // the history row this channel's paths were traced from
        stamp: '',     // the geometry they were traced into
        paths: null,   // one traced Path2D per level
      };
      this.fields.set(channel.id, store);
    }
    return store;
  }

  /**
   * Read a channel's history into its grid, blur it, and ease the drawn field
   * toward it. Row 0 is the oldest frame, so time runs down the sheet toward now.
   *
   * The easing is in place, on a field that is scrolling — which is to say it is a
   * short motion blur along the time axis, and that is exactly the intent. Ink
   * drags a little as the sheet moves under it.
   */
  buildField(channel, cols, rows, stride, dtMs) {
    const C = CONFIG.contour;
    const store = this.fieldFor(channel, cols, rows);
    const sg = channel.spectrogram;
    const { field, target, scratch } = store;
    const span = C.decimate ? stride : 1;
    const inv = 1 / span;

    for (let r = 0; r < rows; r++) {
      const base = (rows - 1 - r) * stride;
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let k = 0; k < span; k++) sum += sg.valueAt(base + k, c);
        target[r * cols + c] = sum * inv;
      }
    }
    blurSeparable(target, scratch, cols, rows, C.blur);

    // First frame lands whole: easing up from an empty sheet would open the view
    // with a second of contours swelling out of nothing, which reads as an effect.
    const a = store.primed ? easeCoefficient(dtMs, C.settleMs) : 1;
    store.primed = true;
    if (a >= 1) {
      field.set(target);
    } else {
      for (let i = 0; i < field.length; i++) field[i] += (target[i] - field[i]) * a;
    }
    return field;
  }

  /**
   * The two clocks are deliberately separate. Contours are re-traced only when the
   * history actually advances — 30 times a second, the rate at which there is
   * something new to say — while the sheet is *moved* on every render frame, which
   * is a translation of an already-traced path. Measured on three channels: 2.8 ms
   * to re-trace, 0.01 ms to move. Tracing at the refresh rate would have been
   * twice the work for no more information, and scrolling at the analysis rate is
   * exactly the stepping this view had.
   *
   * @param framePhase  how far the analysis clock is through the current frame,
   *                    0..1. This is the whole of the continuous scroll: without
   *                    it the sheet advances in discrete jumps.
   */
  draw(channels, dtMs, framePhase = 0) {
    const C = CONFIG.contour;
    const [w, h] = this.resize();
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    if (!channels.length) return;

    const pad = Math.min(w, h) * C.margin;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;

    const cols = channels[0].spectrogram.bands;
    const stride = Math.max(1, C.rowStride);
    const rows = Math.floor(CONFIG.history.rows / stride);
    const box = { x0: pad, y0: pad, sx: plotW / (cols - 1), sy: plotH / (rows - 1) };
    const stamp = `${w}x${h}`;

    this.sinceMs += dtMs;
    const scrollPx = C.scroll ? scrollPixels(framePhase, stride, box.sy) : 0;

    ctx.globalCompositeOperation = 'multiply';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const alive = new Set();
    let retraced = false;
    for (const channel of channels) {
      alive.add(channel.id);
      const store = this.fieldFor(channel, cols, rows);
      const head = channel.spectrogram.head;

      if (store.head !== head || store.stamp !== stamp || !store.paths) {
        const field = this.buildField(channel, cols, rows, stride, this.sinceMs);
        store.paths = C.levels.map((level) => {
          const path = new Path2D();
          this.traceLevel(path, field, cols, rows, level, box);
          return path;
        });
        store.head = head;
        store.stamp = stamp;
        retraced = true;
      }

      const [r, g, b] = channel.ink.rgb;
      const ink = (a) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a.toFixed(4)})`;
      ctx.setTransform(1, 0, 0, 1, 0, -scrollPx);
      for (let li = 0; li < C.levels.length; li++) {
        const weight = (li + 1) / C.levels.length;
        ctx.strokeStyle = ink(C.alphaLow + (C.alphaHigh - C.alphaLow) * weight);
        ctx.lineWidth = C.lineWidth * (0.7 + 0.6 * weight);
        ctx.stroke(store.paths[li]);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (retraced) this.sinceMs = 0;
    // A place that has been taken off should not keep a megabyte of landscape.
    for (const id of this.fields.keys()) if (!alive.has(id)) this.fields.delete(id);

    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Every contour at one level, emitted into a path as smooth curves.
   *
   * `sink` is anything with moveTo/lineTo/closePath — a Path2D in the piece, a
   * recorder in the tests.
   *
   * The tracing is in grid space and the culling with it, so what counts as a
   * speck does not change with the size of the window.
   */
  traceLevel(sink, f, cols, rows, level, box) {
    const C = CONFIG.contour;
    for (const line of marchPolylines(f, cols, rows, level)) {
      if (polylineLength(line.pts, line.closed) < C.minCells) continue;
      const pixels = toPixels(line.pts, box);
      emitPath(sink, chaikin(pixels, line.closed, C.smoothPasses), line.closed);
    }
  }
}

/**
 * Marching squares, chained into whole contours.
 *
 * Emitting loose segments — which is what this did — costs more than it looks. In
 * multiply, every round cap overlaps its neighbour's and the line beads; there is
 * no path to smooth, so the marching grid's staircase stays; and there is nothing
 * to measure, so a two-cell noise island is as important as a ridge.
 *
 * Chaining is exact rather than tolerance-based. A crossing lives on a specific
 * grid edge, so it can be named by that edge — (row, col, horizontal|vertical) —
 * and the two cells that share an edge name the same crossing by construction.
 * No float keys, no epsilon, no gaps.
 *
 * @returns {{pts: Float64Array, closed: boolean}[]} contours in grid coordinates,
 *          x = column, y = row.
 */
export function marchPolylines(f, cols, rows, level) {
  const at = (r, c) => f[r * cols + c];
  const H = (r, c) => (r * cols + c) * 2;       // edge from (r,c) to (r,c+1)
  const V = (r, c) => (r * cols + c) * 2 + 1;   // edge from (r,c) to (r+1,c)

  const point = new Map();   // edge key -> [x, y] in grid space
  const link = new Map();    // edge key -> up to two neighbouring edge keys

  const markH = (r, c) => {
    const k = H(r, c);
    if (!point.has(k)) point.set(k, [c + inter(at(r, c), at(r, c + 1), level), r]);
    return k;
  };
  const markV = (r, c) => {
    const k = V(r, c);
    if (!point.has(k)) point.set(k, [c, r + inter(at(r, c), at(r + 1, c), level)]);
    return k;
  };
  const join = (a, b) => {
    if (a === b) return;
    for (const [from, to] of [[a, b], [b, a]]) {
      const list = link.get(from);
      if (!list) link.set(from, [to]);
      else if (list.length < 2 && list[0] !== to) list.push(to);
    }
  };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = at(r, c);
      const tr = at(r, c + 1);
      const br = at(r + 1, c + 1);
      const bl = at(r + 1, c);

      let code = 0;
      if (tl > level) code |= 8;
      if (tr > level) code |= 4;
      if (br > level) code |= 2;
      if (bl > level) code |= 1;
      if (code === 0 || code === 15) continue;

      const top = () => markH(r, c);
      const bottom = () => markH(r + 1, c);
      const left = () => markV(r, c);
      const right = () => markV(r, c + 1);

      switch (code) {
        case 1: case 14: join(left(), bottom()); break;
        case 2: case 13: join(bottom(), right()); break;
        case 3: case 12: join(left(), right()); break;
        case 4: case 11: join(top(), right()); break;
        case 6: case 9:  join(top(), bottom()); break;
        case 7: case 8:  join(left(), top()); break;
        // Saddles: both diagonals cross. Resolve by the cell's average, so the
        // two cells either side of the ambiguity cannot disagree.
        case 5: {
          const mid = (tl + tr + br + bl) / 4;
          if (mid > level) { join(left(), top()); join(bottom(), right()); }
          else { join(left(), bottom()); join(top(), right()); }
          break;
        }
        case 10: {
          const mid = (tl + tr + br + bl) / 4;
          if (mid > level) { join(left(), bottom()); join(top(), right()); }
          else { join(left(), top()); join(bottom(), right()); }
          break;
        }
        default: break;
      }
    }
  }

  // Every crossing has degree 1 or 2 — an edge is shared by at most two cells and
  // each cell puts at most one segment end on it — so the graph is a set of simple
  // paths and cycles. Walk the paths first, from their loose ends, then whatever
  // is left is a closed loop.
  const out = [];
  const seen = new Set();
  const walk = (start) => {
    const chain = [start];
    seen.add(start);
    let cur = start;
    for (;;) {
      const next = (link.get(cur) ?? []).find((k) => !seen.has(k));
      if (next === undefined) break;
      seen.add(next);
      chain.push(next);
      cur = next;
    }
    const closed = chain.length > 2 && (link.get(cur) ?? []).includes(start);
    const pts = new Float64Array(chain.length * 2);
    for (let i = 0; i < chain.length; i++) {
      const [x, y] = point.get(chain[i]);
      pts[i * 2] = x;
      pts[i * 2 + 1] = y;
    }
    out.push({ pts, closed });
  };

  for (const [k, list] of link) if (list.length === 1 && !seen.has(k)) walk(k);
  for (const k of link.keys()) if (!seen.has(k)) walk(k);
  return out;
}

/** Length along a polyline, in whatever units it is given. */
export function polylineLength(pts, closed = false) {
  const n = pts.length / 2;
  if (n < 2) return 0;
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  }
  if (closed) total += Math.hypot(pts[0] - pts[(n - 1) * 2], pts[1] - pts[(n - 1) * 2 + 1]);
  return total;
}

/**
 * Chaikin corner cutting. Each pass replaces every corner with the quarter and
 * three-quarter points along its two edges, which is a quadratic B-spline in the
 * limit — smooth, and strictly inside the original outline, so a contour can never
 * be smoothed out past the level it belongs to.
 *
 * Open lines keep their first and last point: those sit on the edge of the sheet,
 * and pulling them inward would leave the drawing floating off its own margin.
 */
export function chaikin(pts, closed = false, passes = 2) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const n = cur.length / 2;
    if (n < 3) return cur;
    const segments = closed ? n : n - 1;
    const out = new Float64Array((segments * 2 + (closed ? 0 : 2)) * 2);
    let w = 0;
    if (!closed) { out[w++] = cur[0]; out[w++] = cur[1]; }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % n;
      const ax = cur[i * 2], ay = cur[i * 2 + 1];
      const bx = cur[j * 2], by = cur[j * 2 + 1];
      out[w++] = ax * 0.75 + bx * 0.25;
      out[w++] = ay * 0.75 + by * 0.25;
      out[w++] = ax * 0.25 + bx * 0.75;
      out[w++] = ay * 0.25 + by * 0.75;
    }
    if (!closed) { out[w++] = cur[(n - 1) * 2]; out[w++] = cur[(n - 1) * 2 + 1]; }
    cur = out;
  }
  return cur;
}

/** Grid coordinates to pixels. */
export function toPixels(pts, box) {
  const out = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = box.x0 + pts[i] * box.sx;
    out[i + 1] = box.y0 + pts[i + 1] * box.sy;
  }
  return out;
}

/**
 * How far up the sheet has moved since the last time it was traced.
 *
 * A place's history climbs the sheet by one analysis frame — 1/stride of a grid
 * row — every time the analysis advances. Between advances the traced paths are
 * simply shifted by the fraction of a frame that has elapsed, which is what turns
 * a 15 Hz staircase into movement. The offset is always less than one grid row, so
 * it can never be mistaken for the sheet having scrolled twice.
 */
export const scrollPixels = (framePhase, stride, sy) => (
  (clamp(framePhase, 0, 1) / Math.max(1, stride)) * sy
);

function emitPath(ctx, pts, closed) {
  const n = pts.length / 2;
  if (n < 2) return;
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  if (closed) ctx.closePath();
}

const inter = (a, b, level) => clamp((level - a) / ((b - a) || 1e-6), 0, 1);

/** Separable box blur, `passes` times — cheap, and enough to make landscape. */
export function blurSeparable(f, tmp, cols, rows, passes) {
  for (let p = 0; p < passes; p++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const a = f[i - (c > 0 ? 1 : 0)];
        const b = f[i];
        const d = f[i + (c < cols - 1 ? 1 : 0)];
        tmp[i] = (a + b + b + d) * 0.25;
      }
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const i = r * cols + c;
        const a = tmp[i - (r > 0 ? cols : 0)];
        const b = tmp[i];
        const d = tmp[i + (r < rows - 1 ? cols : 0)];
        f[i] = (a + b + b + d) * 0.25;
      }
    }
  }
}
