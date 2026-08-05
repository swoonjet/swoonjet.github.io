// Motif memory.
//
// A motif is a spectrogram shape the session has heard before. Shapes are
// reduced to a small orientation-preserving fingerprint, stored, and compared
// against everything that follows. When one comes back, the piece does not
// repeat itself — it answers with a variation, and the variations keep moving
// as the shape keeps returning.

import { cosine, hash, pick, clamp } from '../core/util.js';
import { CONFIG } from '../core/config.js';

/**
 * Reduce a patch (frames x bands, oldest first) to an fpFrames x fpBands
 * fingerprint. Mean-removed and L2-normalised so loudness drops out and only
 * the shape survives.
 */
export function fingerprint(patch, bands, frames, fpBands = CONFIG.motif.fpBands, fpFrames = CONFIG.motif.fpFrames) {
  const fp = new Float32Array(fpBands * fpFrames);
  for (let tf = 0; tf < fpFrames; tf++) {
    const t0 = Math.floor((tf * frames) / fpFrames);
    const t1 = Math.max(t0 + 1, Math.floor(((tf + 1) * frames) / fpFrames));
    for (let bf = 0; bf < fpBands; bf++) {
      const b0 = Math.floor((bf * bands) / fpBands);
      const b1 = Math.max(b0 + 1, Math.floor(((bf + 1) * bands) / fpBands));
      let acc = 0, n = 0;
      for (let t = t0; t < t1; t++) {
        for (let b = b0; b < b1; b++) { acc += patch[t * bands + b]; n++; }
      }
      fp[tf * fpBands + bf] = n ? acc / n : 0;
    }
  }

  let m = 0;
  for (let i = 0; i < fp.length; i++) m += fp[i];
  m /= fp.length;
  let norm = 0;
  for (let i = 0; i < fp.length; i++) { fp[i] -= m; norm += fp[i] * fp[i]; }
  norm = Math.sqrt(norm);
  if (norm > 1e-6) for (let i = 0; i < fp.length; i++) fp[i] /= norm;
  return fp;
}

const ADJECTIVES = {
  low:  ['long', 'grey', 'slow', 'deep', 'patient', 'heavy'],
  mid:  ['near', 'plain', 'quiet', 'level', 'ordinary', 'close'],
  high: ['small', 'bright', 'thin', 'quick', 'pale', 'sharp'],
};
const NOUNS = {
  short:   ['bell', 'tack', 'match', 'latch', 'coin', 'spark'],
  medium:  ['door', 'figure', 'signal', 'answer', 'gesture', 'visitor'],
  long:    ['shadow', 'tide', 'engine', 'weather', 'corridor', 'sleeper'],
};

/** An evocative, stable name for a shape: "the long shadow", "the small bell". */
export function nameShape(fp, desc) {
  const seed = hash(Array.from(fp, (v) => Math.round(v * 40)).join(','));
  const register = desc.centroidMean < 0.3 ? 'low' : desc.centroidMean < 0.6 ? 'mid' : 'high';
  const length = desc.duration < 0.28 ? 'short' : desc.duration < 1.1 ? 'medium' : 'long';
  return `the ${pick(ADJECTIVES[register], seed)} ${pick(NOUNS[length], seed >>> 7)}`;
}

export class MotifMemory {
  constructor(opts = {}) {
    this.threshold = opts.threshold ?? CONFIG.motif.matchThreshold;
    this.maxMotifs = opts.maxMotifs ?? CONFIG.motif.maxMotifs;
    this.minGapMs = opts.minGapMs ?? CONFIG.motif.minGapMs;
    this.motifs = [];
    this.nextId = 1;
  }

  /**
   * Offer a shape to the memory.
   * Returns { motif, isReturn, similarity, variation|null }.
   * isReturn is only true when the shape has been away long enough to be missed.
   */
  observe(fp, desc, timeMs, meta = {}) {
    let best = null, bestSim = -1;
    for (const m of this.motifs) {
      const sim = cosine(fp, m.fingerprint);
      if (sim > bestSim) { bestSim = sim; best = m; }
    }

    if (best && bestSim >= this.threshold) {
      const gap = timeMs - best.lastSeenMs;
      best.lastSeenMs = timeMs;
      best.count++;
      // Drift the stored shape slowly toward what the room is doing now.
      for (let i = 0; i < fp.length; i++) {
        best.fingerprint[i] = best.fingerprint[i] * 0.86 + fp[i] * 0.14;
      }
      best.patternIds.add(meta.patternId ?? 'unknown');
      const isReturn = gap >= this.minGapMs;
      if (isReturn) best.returns++;
      return {
        motif: best,
        isReturn,
        similarity: bestSim,
        gapMs: gap,
        variation: isReturn ? variationFor(best, best.returns) : null,
      };
    }

    const motif = {
      id: this.nextId++,
      fingerprint: Float32Array.from(fp),
      name: nameShape(fp, desc),
      firstSeenMs: timeMs,
      lastSeenMs: timeMs,
      count: 1,
      returns: 0,
      patternIds: new Set([meta.patternId ?? 'unknown']),
      channel: meta.channel ?? 0,
      register: desc.centroidMean,
      duration: desc.duration,
    };
    this.motifs.push(motif);
    if (this.motifs.length > this.maxMotifs) {
      // Forget the least-heard, oldest shape.
      this.motifs.sort((a, b) => (a.count - b.count) || (a.lastSeenMs - b.lastSeenMs));
      this.motifs.shift();
    }
    return { motif, isReturn: false, similarity: bestSim < 0 ? 0 : bestSim, variation: null };
  }

  /** Most-established shapes first — what the session has made of itself. */
  ranked() {
    return [...this.motifs].sort((a, b) => (b.count - a.count) || (b.lastSeenMs - a.lastSeenMs));
  }
}

// The variation ladder. Each return moves further from the original, then the
// cycle folds back — a character that develops rather than a loop.
const LADDER = [
  { label: 'answered a fifth above', transpose: 7,   stretch: 1.0,  reverse: false, density: 1.0, blur: 0.1 },
  { label: 'slowed and reversed',    transpose: -5,  stretch: 1.9,  reverse: true,  density: 0.7, blur: 0.3 },
  { label: 'thinned to an outline',  transpose: 12,  stretch: 0.8,  reverse: false, density: 0.45, blur: 0.05 },
  { label: 'doubled underneath',     transpose: -12, stretch: 1.35, reverse: false, density: 1.5, blur: 0.45 },
  { label: 'blurred into weather',   transpose: 3,   stretch: 2.6,  reverse: true,  density: 1.1, blur: 0.85 },
  { label: 'returned almost plain',  transpose: 0,   stretch: 1.05, reverse: false, density: 0.85, blur: 0.15 },
];

export function variationFor(motif, returnIndex) {
  const step = LADDER[(returnIndex - 1) % LADDER.length];
  const era = Math.floor((returnIndex - 1) / LADDER.length);
  return {
    ...step,
    // Later eras drift wider: the character ages.
    transpose: step.transpose + era * (motif.id % 2 ? 2 : -2),
    stretch: clamp(step.stretch * (1 + era * 0.18), 0.4, 5),
    blur: clamp(step.blur + era * 0.1, 0, 1),
    returnIndex,
  };
}
