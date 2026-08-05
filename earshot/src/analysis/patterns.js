// The reference library.
//
// Every entry describes the *shape* of a sound in spectrogram terms — register,
// duration, attack, how the centre of gravity moves, how noisy it is, how it
// repeats. Nothing here is a recording: these are descriptions, and the matcher
// scores live shapes against them. No audio ships with this piece.

import { clamp, cosine, fits } from '../core/util.js';

/**
 * criteria keys map onto describePatch() output.
 * `registers` is a five-register energy profile: [sub, low, mid, high, top].
 */
export const PATTERNS = [
  {
    id: 'bird',
    noun: 'a bird-shaped cry',
    short: 'BIRD',
    tags: ['flight', 'morning', 'signal', 'small', 'alive', 'forest'],
    registers: [0.02, 0.06, 0.16, 0.44, 0.32],
    criteria: [
      ['duration', 0.06, 0.55, 1.0],
      ['centroidMean', 0.60, 0.94, 1.4],
      ['centroidRange', 0.05, 0.40, 1.0],
      ['flatnessMean', 0.00, 0.34, 1.0],
      ['attack', 0.02, 0.14, 0.7],
    ],
  },
  {
    id: 'footsteps',
    noun: 'a scatter of footsteps',
    short: 'STEPS',
    tags: ['approach', 'human', 'weight', 'rhythm', 'corridor', 'intent'],
    registers: [0.16, 0.34, 0.30, 0.14, 0.06],
    criteria: [
      ['duration', 0.30, 2.20, 0.9],
      ['centroidMean', 0.12, 0.42, 1.3],
      ['onsetDensity', 1.20, 3.80, 1.5],
      // Steps fall at walking pace. Anything modulating faster is a voice.
      ['modulationHz', 0.80, 2.90, 1.4],
      ['jaggedness', 0.35, 2.20, 1.0],
      ['attack', 0.02, 0.12, 0.6],
    ],
  },
  {
    id: 'knock',
    noun: 'a knock',
    short: 'KNOCK',
    tags: ['arrival', 'wood', 'question', 'threshold', 'hand'],
    registers: [0.10, 0.26, 0.34, 0.20, 0.10],
    criteria: [
      ['duration', 0.03, 0.20, 1.4],
      ['attack', 0.01, 0.06, 1.4],
      ['decay', 0.02, 0.16, 1.0],
      ['flatnessMean', 0.22, 0.66, 0.8],
      ['centroidMean', 0.22, 0.62, 0.8],
    ],
  },
  {
    id: 'thud',
    noun: 'a low thud',
    short: 'THUD',
    tags: ['mass', 'floor', 'below', 'event', 'weight'],
    registers: [0.42, 0.34, 0.14, 0.07, 0.03],
    criteria: [
      ['duration', 0.04, 0.42, 1.0],
      ['centroidMean', 0.00, 0.22, 1.6],
      ['attack', 0.01, 0.08, 1.1],
      ['flatnessMean', 0.00, 0.42, 0.7],
    ],
  },
  {
    id: 'hum',
    noun: 'a low hum',
    short: 'HUM',
    tags: ['machine', 'sustain', 'dread', 'ocean', 'sleep', 'current'],
    registers: [0.38, 0.36, 0.16, 0.07, 0.03],
    criteria: [
      ['duration', 0.90, 6.00, 1.3],
      ['centroidMean', 0.00, 0.28, 1.5],
      ['flatnessMean', 0.00, 0.26, 1.3],
      ['jaggedness', 0.00, 0.28, 1.2],
      ['modulationHz', 0.00, 2.20, 0.6],
    ],
  },
  {
    id: 'speech',
    noun: 'a voice',
    short: 'VOICE',
    tags: ['human', 'meaning', 'company', 'secret', 'address'],
    registers: [0.08, 0.26, 0.40, 0.19, 0.07],
    criteria: [
      ['duration', 0.35, 4.00, 0.9],
      ['centroidMean', 0.22, 0.54, 1.3],
      ['modulationHz', 2.60, 8.50, 1.9],
      ['flatnessMean', 0.04, 0.40, 0.9],
      ['jaggedness', 0.20, 1.40, 0.7],
    ],
  },
  {
    id: 'laughter',
    noun: 'laughter',
    short: 'LAUGH',
    tags: ['human', 'warmth', 'break', 'release', 'company'],
    registers: [0.05, 0.20, 0.40, 0.26, 0.09],
    criteria: [
      ['duration', 0.40, 2.60, 1.0],
      ['centroidMean', 0.28, 0.62, 1.1],
      ['modulationHz', 4.00, 11.00, 1.7],
      ['jaggedness', 0.50, 2.60, 1.2],
      ['centroidSlope', -1.60, -0.02, 0.8],
    ],
  },
  {
    id: 'wind',
    noun: 'a long hiss',
    short: 'WIND',
    tags: ['wind', 'distance', 'weather', 'erasure', 'open'],
    registers: [0.06, 0.14, 0.26, 0.31, 0.23],
    criteria: [
      ['duration', 0.80, 6.00, 1.1],
      ['flatnessMean', 0.45, 1.00, 1.6],
      ['centroidMean', 0.44, 0.84, 1.1],
      ['jaggedness', 0.00, 0.42, 1.0],
      ['onsetDensity', 0.00, 1.20, 0.7],
    ],
  },
  {
    id: 'rain',
    noun: 'a fine scatter',
    short: 'RAIN',
    tags: ['weather', 'many', 'patience', 'glass', 'grain'],
    registers: [0.04, 0.11, 0.24, 0.34, 0.27],
    criteria: [
      ['duration', 0.60, 6.00, 0.9],
      ['flatnessMean', 0.40, 1.00, 1.3],
      ['centroidMean', 0.48, 0.90, 1.1],
      ['onsetDensity', 3.60, 14.00, 1.7],
    ],
  },
  {
    id: 'drip',
    noun: 'a single drop',
    short: 'DRIP',
    tags: ['time', 'water', 'cave', 'waiting', 'small'],
    registers: [0.03, 0.09, 0.22, 0.40, 0.26],
    criteria: [
      ['duration', 0.03, 0.26, 1.3],
      ['centroidMean', 0.48, 0.92, 1.3],
      ['flatnessMean', 0.00, 0.30, 1.4],
      ['attack', 0.01, 0.05, 1.2],
    ],
  },
  {
    id: 'scrape',
    noun: 'a scrape',
    short: 'SCRAPE',
    tags: ['friction', 'furniture', 'effort', 'resistance', 'surface'],
    registers: [0.08, 0.22, 0.34, 0.24, 0.12],
    criteria: [
      ['duration', 0.25, 2.20, 1.0],
      ['flatnessMean', 0.34, 0.86, 1.2],
      ['centroidMean', 0.32, 0.70, 1.1],
      ['jaggedness', 0.30, 1.80, 1.1],
    ],
  },
];

export const PATTERN_BY_ID = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

/** Unrecognised shapes are still events — the piece should notice them. */
export const UNKNOWN = {
  id: 'unknown',
  noun: 'something unnamed',
  short: 'UNNAMED',
  tags: ['unknown', 'edge', 'stranger'],
};

/**
 * Score one described patch against every template.
 * Returns entries sorted best-first: { id, pattern, confidence, parts }.
 */
export function matchAll(desc) {
  const out = PATTERNS.map((p) => {
    let acc = 0, wsum = 0;
    const parts = {};
    for (const [key, lo, hi, weight] of p.criteria) {
      const v = desc[key] ?? 0;
      const s = fits(v, lo, hi);
      parts[key] = s;
      acc += s * weight;
      wsum += weight;
    }
    const criteriaScore = wsum > 0 ? acc / wsum : 0;

    // Register profile similarity, sharpened so a merely plausible register
    // does not carry a bad shape.
    const reg = cosine(desc.registers ?? [0, 0, 0, 0, 0], p.registers);
    const regScore = clamp((reg - 0.72) / 0.28, 0, 1);

    const confidence = clamp(criteriaScore * 0.68 + regScore * 0.32, 0, 1);
    return { id: p.id, pattern: p, confidence, criteriaScore, regScore, parts };
  });
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

/** Best match, or the unknown pattern when nothing is convincing. */
export function classify(desc, minConfidence = 0.42) {
  const ranked = matchAll(desc);
  const best = ranked[0];
  if (!best || best.confidence < minConfidence) {
    return { id: UNKNOWN.id, pattern: UNKNOWN, confidence: best?.confidence ?? 0, ranked };
  }
  // Ambiguity: if the runner-up is within 6%, the room is genuinely between two
  // readings. Keep both — the orchestrator likes an ambiguous omen.
  const alt = ranked[1] && best.confidence - ranked[1].confidence < 0.06 ? ranked[1] : null;
  return { id: best.id, pattern: best.pattern, confidence: best.confidence, alt, ranked };
}
