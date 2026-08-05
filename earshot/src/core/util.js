// Small shared helpers. Nothing here touches the DOM or Web Audio, so the
// analysis modules that import it stay testable in plain Node.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

// Sine ease in/out — the only easing this piece uses.
export const easeSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

/** Gaussian membership: 1.0 at the centre of [lo,hi], falling off outside it. */
export function fits(value, lo, hi, softness = 0.35) {
  if (value >= lo && value <= hi) return 1;
  const span = Math.max(hi - lo, 1e-6);
  const d = value < lo ? lo - value : value - hi;
  return Math.exp(-((d / (span * softness)) ** 2));
}

/** FNV-1a. Used everywhere a choice must be stable for the same input. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic pick — same seed, same choice, forever. */
export function pick(arr, seed) {
  return arr[(typeof seed === 'string' ? hash(seed) : seed >>> 0) % arr.length];
}

/** Deterministic 0..1 float from a seed. */
export function rand01(seed) {
  return ((typeof seed === 'string' ? hash(seed) : seed >>> 0) % 100000) / 100000;
}

export function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/** Median absolute deviation — robust spread, used for adaptive onset thresholds. */
export function mad(arr) {
  if (!arr.length) return 0;
  const m = median(arr);
  const dev = Array.from(arr, (v) => Math.abs(v - m));
  return median(dev);
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = Array.from(arr).sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Value at a fractional rank, interpolated between neighbours. `p` is 0..1.
 *
 * Used on dB readings, where the mean is dragged around by whatever is loudest
 * and a rank is not: the 78th percentile of a stream's band peaks is a stable
 * description of its background even while a lorry goes past.
 */
export function percentile(arr, p) {
  const n = arr.length;
  if (!n) return 0;
  const s = Array.from(arr).sort((a, b) => a - b);
  const pos = clamp(p, 0, 1) * (n - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  // The equality check is not an optimisation: a silent analyser reports -Infinity
  // in every bin, and interpolating between two of those gives NaN.
  if (f === 0 || s[i] === s[i + 1]) return s[i];
  return s[i] + (s[i + 1] - s[i]) * f;
}

/**
 * EMA coefficient for a half-life, given a step. Shared so that "half-life" means
 * the same thing whether the caller steps in seconds or in milliseconds.
 */
export const easeCoefficient = (dt, halfLife) => (
  halfLife > 0 ? 1 - Math.pow(0.5, dt / halfLife) : 1
);

/** Cosine similarity of two equal-length vectors. */
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d < 1e-9 ? 0 : dot / d;
}

/** Exponential moving average with a half-life in seconds. */
export class Smoother {
  constructor(halfLifeSec, initial = 0) {
    this.halfLife = halfLifeSec;
    this.value = initial;
  }
  push(v, dt) {
    const a = 1 - Math.pow(0.5, dt / this.halfLife);
    this.value += (v - this.value) * a;
    return this.value;
  }
}

/** Fixed-capacity ring of numbers, for rolling statistics. */
export class Ring {
  constructor(capacity) {
    this.buf = new Float32Array(capacity);
    this.n = 0;
    this.head = 0;
  }
  push(v) {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
  }
  toArray() {
    return Array.from(this.buf.subarray(0, this.n));
  }
}

export function formatClock(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
