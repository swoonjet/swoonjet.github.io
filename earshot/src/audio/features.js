// Descriptors of spectrogram shape. Pure functions over band frames — no audio
// objects — so the pattern library can be tested against synthetic shapes.

import { clamp, mean } from '../core/util.js';

const EPS = 1e-7;

/** Per-frame description of one band vector. */
export function frameFeatures(f) {
  const n = f.length;
  let sum = 0, weighted = 0, logSum = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const v = f[i];
    sum += v;
    weighted += v * i;
    logSum += Math.log(v + EPS);
    if (v > peak) peak = v;
  }
  const level = sum / n;
  const centroid = sum > EPS ? weighted / sum / (n - 1) : 0;

  let variance = 0;
  if (sum > EPS) {
    const c = centroid * (n - 1);
    for (let i = 0; i < n; i++) variance += f[i] * (i - c) * (i - c);
    variance /= sum;
  }

  // Spectral flatness: 1 = noise-like, 0 = a clear tone or resonance.
  const geo = Math.exp(logSum / n);
  const flatness = clamp(geo / (level + EPS), 0, 1);

  // Rolloff: where 85% of the energy sits.
  let cum = 0, rolloff = n - 1;
  const target = sum * 0.85;
  for (let i = 0; i < n; i++) {
    cum += f[i];
    if (cum >= target) { rolloff = i; break; }
  }

  let lo = 0, hi = 0;
  const half = n >> 1;
  for (let i = 0; i < half; i++) lo += f[i];
  for (let i = half; i < n; i++) hi += f[i];

  return {
    level,
    peak,
    centroid,
    spread: Math.sqrt(variance) / n,
    flatness,
    rolloff: rolloff / (n - 1),
    tilt: (hi - lo) / (hi + lo + EPS),
    bandEnergy: fifths(f),
  };
}

/** Energy in five registers, normalised to sum 1. */
export function fifths(f) {
  const n = f.length;
  const out = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const k = Math.min(4, Math.floor((i / n) * 5));
    out[k] += f[i];
  }
  const total = out.reduce((a, b) => a + b, 0) + EPS;
  return out.map((v) => v / total);
}

/**
 * Describe a whole event: a patch of `frames` band-vectors, oldest first.
 * This is the vector the pattern library scores against.
 */
export function describePatch(patch, bands, frames, frameHz) {
  const envelope = new Float32Array(frames);
  const centroids = new Float32Array(frames);
  const flatnesses = new Float32Array(frames);
  const registers = [0, 0, 0, 0, 0];

  for (let t = 0; t < frames; t++) {
    const f = patch.subarray(t * bands, (t + 1) * bands);
    const ff = frameFeatures(f);
    envelope[t] = ff.level;
    centroids[t] = ff.centroid;
    flatnesses[t] = ff.flatness;
    for (let k = 0; k < 5; k++) registers[k] += ff.bandEnergy[k];
  }
  for (let k = 0; k < 5; k++) registers[k] /= frames;

  const duration = frames / frameHz;
  const peakIdx = argMax(envelope);
  const peak = envelope[peakIdx];

  // Attack: time from 10% of peak up to the peak.
  let attackStart = 0;
  for (let t = peakIdx; t >= 0; t--) {
    if (envelope[t] <= peak * 0.1) { attackStart = t; break; }
  }
  const attack = Math.max(1 / frameHz, (peakIdx - attackStart) / frameHz);

  // Decay: fall from peak to 10%, in seconds. Long = sustained.
  let decayEnd = frames - 1;
  for (let t = peakIdx; t < frames; t++) {
    if (envelope[t] <= peak * 0.1) { decayEnd = t; break; }
  }
  const decay = Math.max(1 / frameHz, (decayEnd - peakIdx) / frameHz);

  // Weighted centroid statistics — quiet frames should not steer the shape.
  const wSum = envelope.reduce((a, b) => a + b, 0) + EPS;
  let centroidMean = 0;
  for (let t = 0; t < frames; t++) centroidMean += centroids[t] * envelope[t];
  centroidMean /= wSum;

  return {
    duration,
    frames,
    attack,
    decay,
    peak,
    levelMean: mean(Array.from(envelope)),
    centroidMean,
    centroidSlope: slope(centroids, envelope) * frameHz, // per second
    centroidRange: range(centroids, envelope),
    flatnessMean: weightedMean(flatnesses, envelope),
    registers,
    modulationHz: modulationRate(envelope, frameHz),
    jaggedness: jaggedness(envelope),
    onsetDensity: onsetDensity(envelope, frameHz),
    envelope,
    centroids,
  };
}

function argMax(a) {
  let bi = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
  return bi;
}

function weightedMean(v, w) {
  let s = 0, ws = 0;
  for (let i = 0; i < v.length; i++) { s += v[i] * w[i]; ws += w[i]; }
  return ws > EPS ? s / ws : 0;
}

/** Weighted least-squares slope, per frame. */
function slope(v, w) {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < v.length; i++) {
    const wi = w[i] + EPS;
    sw += wi; sx += wi * i; sy += wi * v[i];
    sxx += wi * i * i; sxy += wi * i * v[i];
  }
  const den = sw * sxx - sx * sx;
  return Math.abs(den) < EPS ? 0 : (sw * sxy - sx * sy) / den;
}

/** Spread of the centroid trajectory across the loud part of the event. */
function range(v, w) {
  let lo = Infinity, hi = -Infinity, peak = 0;
  for (let i = 0; i < w.length; i++) if (w[i] > peak) peak = w[i];
  for (let i = 0; i < v.length; i++) {
    if (w[i] < peak * 0.35) continue;
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  return isFinite(lo) && isFinite(hi) ? hi - lo : 0;
}

/**
 * Dominant amplitude-modulation rate in 2–14 Hz, via autocorrelation of the
 * de-meaned envelope. Speech and laughter live here; a hum does not.
 */
export function modulationRate(env, frameHz) {
  const n = env.length;
  if (n < 8) return 0;
  const m = mean(Array.from(env));
  const x = Float32Array.from(env, (v) => v - m);
  const minLag = Math.max(1, Math.floor(frameHz / 14));
  const maxLag = Math.min(n - 2, Math.floor(frameHz / 2));
  if (maxLag <= minLag) return 0;

  let best = 0, bestLag = 0, zero = 0;
  for (let i = 0; i < n; i++) zero += x[i] * x[i];
  if (zero < EPS) return 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += x[i] * x[i + lag];
    acc /= zero;
    if (acc > best) { best = acc; bestLag = lag; }
  }
  return best > 0.18 && bestLag > 0 ? frameHz / bestLag : 0;
}

/** Mean absolute frame-to-frame change, normalised — how restless the envelope is. */
export function jaggedness(env) {
  if (env.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < env.length; i++) d += Math.abs(env[i] - env[i - 1]);
  d /= env.length - 1;
  const m = mean(Array.from(env)) + EPS;
  return clamp(d / m, 0, 4);
}

/** Rising edges per second — rain and scatter are dense, a hum is not. */
export function onsetDensity(env, frameHz) {
  if (env.length < 3) return 0;
  let peak = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i];
  const thr = peak * 0.28;
  let count = 0;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > thr && env[i] > env[i - 1] && env[i] >= env[i + 1]) count++;
  }
  return count / (env.length / frameHz);
}
