// The bloom view.
//
// The same spectrogram data, read as something growing rather than something
// measured. Frequency runs around the circle, time ripples outward from the
// centre, and amplitude swells the radius. Each channel occupies its own annulus,
// so the sources are concentric rather than stacked.
//
// Coincidence is not marked here. It does not need to be: every channel shares
// the same angular mapping, so the same frequency is at the same angle on all of
// them, and two places holding a frequency together show up as swells that line
// up into a spine radiating from the centre. An earlier version offset each
// channel by the golden angle and then tried to mark coincidence with red dots —
// which was a patch over a problem of its own making, and read as specks.
//
// Three decisions do most of the work:
//
// 1. The spectrum is *mirrored* around the circle — a triangle mapping, low
//    frequencies at the top, high at the bottom, and back again. Wrapping the
//    spectrum once around the circle would put a hard seam where Nyquist meets
//    DC. Mirroring removes the seam entirely and leaves bilateral symmetry, which
//    is what makes leaves and shells and faces read as organic.
// 2. Everything is interpolated. Catmull-Rom across the frequency axis, a rolling
//    mean across time, and Catmull-Rom again to turn the sampled ring into bezier
//    curves. There is no step anywhere in the geometry.
// 3. It draws in multiply. Every ring is ink laid on paper at low opacity, so tone
//    accumulates where rings overlap instead of one hiding another.

import { CONFIG } from '../core/config.js';
import { clamp, easeSine } from '../core/util.js';

const PAPER = '#f2f0eb';
const TAU = Math.PI * 2;

export class Bloom {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('2D canvas is required for the bloom view.');
    this.phaseMs = 0;
    this.breath = 0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return [w, h, dpr];
  }

  draw(channels, dtMs) {
    const B = CONFIG.bloom;
    const [w, h] = this.resize();
    const ctx = this.ctx;
    this.phaseMs += dtMs;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    if (!channels.length) return;

    // One slow breath, driven by how loud the world is, so the whole field
    // expands and settles rather than sitting still.
    const level = channels.reduce((a, c) => a + (c.level ?? 0), 0) / channels.length;
    this.breath += (level - this.breath) * Math.min(1, dtMs / 900);

    const cx = w / 2;
    const cy = h / 2;
    const unit = Math.min(w, h) / 2;
    const inner = unit * B.innerRadius;
    const outer = unit * B.outerRadius * (1 + this.breath * B.breathDepth);
    // Every channel uses the whole radius. Giving each its own annulus turned the
    // figure into a target, with the outermost hiding everything inside it.
    const gap = (outer - inner) / Math.max(1, B.rings - 1);

    // A very slow turn, eased at both ends: never a constant spin.
    const period = B.turnPeriodSec * 1000;
    const t = (this.phaseMs % period) / period;
    const turn = (easeSine(t < 0.5 ? t * 2 : (1 - t) * 2) * 2 - 1) * B.turnDegrees * (Math.PI / 180);

    ctx.globalCompositeOperation = 'multiply';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    channels.forEach((channel, ci) => {
      // No per-channel angular offset. All channels share one mapping so that the
      // same frequency lands at the same angle on every one of them, and a
      // coincidence between two places reads as aligned swells.
      const phase = turn;

      // Oldest first, so the newest contour lands on top of its own history.
      for (let r = B.rings - 1; r >= 0; r--) {
        const newness = 1 - r / Math.max(1, B.rings - 1);
        const age = Math.round((r / Math.max(1, B.rings - 1)) * (CONFIG.history.rows - 4));
        // Stagger the channels by a fraction of a gap so their contours
        // interleave rather than sitting on the same radii — the interference
        // between them is where this view gets its texture.
        const base = inner + gap * (r + ci * (B.channelStagger ?? 0));
        const ring = this.ringPoints(channel, age, base, gap * B.swell, phase, cx, cy);

        tracePath(ctx, ring);
        if (r === 0) {
          ctx.fillStyle = inkRgba(channel.ink.rgb, B.coreAlpha);
          ctx.fill();
        }
        ctx.strokeStyle = inkRgba(channel.ink.rgb, lerpAlpha(B.strokeOld, B.strokeNew, newness));
        ctx.lineWidth = B.lineWidth * (0.75 + 0.5 * newness);
        ctx.stroke();
      }
    });

    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * One closed contour for a channel at a given age.
   * `age` is in analysis frames; 0 is now. `swell` is in pixels.
   */
  ringPoints(channel, age, base, swell, phase, cx, cy) {
    const B = CONFIG.bloom;
    const sg = channel.spectrogram;
    const bands = sg.bands;
    const samples = B.samples;
    const pts = new Float64Array(samples * 2);

    for (let s = 0; s < samples; s++) {
      const u = s / samples;
      // Mirror: 0 -> 1 -> 0 across the circle, so there is no seam at the join.
      const mirrored = 1 - Math.abs(2 * u - 1);
      const bandPos = mirrored * (bands - 1);

      // Rolling mean across time, then a cubic across frequency: smooth in both.
      let amp = 0;
      for (let k = -1; k <= 1; k++) {
        amp += sampleBand(sg, clamp(age + k * B.timeSmooth, 0, sg.rows - 1), bandPos);
      }
      amp /= 3;

      const shaped = Math.pow(clamp((amp - CONFIG.visual.knee) / (1 - CONFIG.visual.knee), 0, 1), 0.85);
      const radius = base + shaped * swell;
      const a = u * TAU + phase;
      pts[s * 2] = cx + Math.cos(a) * radius;
      pts[s * 2 + 1] = cy + Math.sin(a) * radius;
    }
    return pts;
  }

}

function inkRgba([r, g, b], alpha) {
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha.toFixed(4)})`;
}

const lerpAlpha = (a, b, t) => a + (b - a) * t;

/** Catmull-Rom across the frequency axis: no steps between bands. */
function sampleBand(sg, age, pos) {
  const i = Math.floor(pos);
  const f = pos - i;
  const at = (k) => sg.valueAt(age, clamp(k, 0, sg.bands - 1));
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/** Closed Catmull-Rom through the sampled points, emitted as beziers. */
function tracePath(ctx, pts) {
  const n = pts.length / 2;
  const x = (i) => pts[(((i % n) + n) % n) * 2];
  const y = (i) => pts[(((i % n) + n) % n) * 2 + 1];

  ctx.beginPath();
  ctx.moveTo(x(0), y(0));
  for (let i = 0; i < n; i++) {
    const x0 = x(i - 1), y0 = y(i - 1);
    const x1 = x(i), y1 = y(i);
    const x2 = x(i + 1), y2 = y(i + 1);
    const x3 = x(i + 2), y3 = y(i + 2);
    ctx.bezierCurveTo(
      x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6,
      x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6,
      x2, y2,
    );
  }
  ctx.closePath();
}
