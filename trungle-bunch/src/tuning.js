// Pitch is carried everywhere as CENTS above the root. Frequency is only
// computed at the moment a voice is struck, so bends and microtonal nudges
// compose additively without rounding through Hz.

export const ROOT_HZ = 103.83; // low G#/Ab — dark enough to sit under the chimes

// A seven-note just MAJOR scale. The instrument starts in tune with itself so
// that the microtonal layer reads as a deliberate departure rather than noise.
export const SCALE = [
  0, // 1/1
  203.91, // 9/8
  386.31, // 5/4  — major third; was 6/5, which soured the whole colony
  498.04, // 4/3
  701.96, // 3/2
  884.36, // 5/3
  1088.27, // 15/8
];

// The drone is built as a plain major triad in just ratios, so it stays put and
// gives the sweeping voices something to be in tune against.
export const MAJOR_THIRD = 5 / 4;
export const PERFECT_FIFTH = 3 / 2;

// Just intervals with a simplicity weight. Used both to score consonance
// between two sounding pitches and as the snap targets for self-tuning.
export const JUST = [
  { c: 0, w: 1.0 },
  { c: 111.73, w: 0.3 }, // 16/15
  { c: 203.91, w: 0.55 }, // 9/8
  { c: 315.64, w: 0.7 }, // 6/5
  { c: 386.31, w: 0.82 }, // 5/4
  { c: 498.04, w: 0.86 }, // 4/3
  { c: 551.32, w: 0.34 }, // 11/8
  { c: 701.96, w: 0.95 }, // 3/2
  { c: 813.69, w: 0.68 }, // 8/5
  { c: 884.36, w: 0.74 }, // 5/3
  { c: 968.83, w: 0.46 }, // 7/4
  { c: 1088.27, w: 0.38 }, // 15/8
  { c: 1200, w: 1.0 },
];

export const centsToHz = (cents) => ROOT_HZ * Math.pow(2, cents / 1200);
export const centsToRatio = (cents) => Math.pow(2, cents / 1200);

// 0..1 — how consonant two pitches are, octave-reduced.
export function consonance(centsA, centsB) {
  const interval = Math.abs(centsA - centsB) % 1200;
  let best = 0;
  for (const j of JUST) {
    const d = (interval - j.c) / 26;
    const score = j.w * Math.exp(-d * d);
    if (score > best) best = score;
  }
  return best;
}

// Nearest just interval to a signed cents delta, octave preserved. This is what
// a hovered cluster listens for when it tunes itself to its neighbours.
export function snapToJust(delta) {
  const oct = Math.floor(delta / 1200);
  const res = delta - oct * 1200;
  let best = JUST[0];
  let bestScore = Infinity;
  for (const j of JUST) {
    // bias toward simple ratios so a cluster prefers a fifth over a tritone
    const score = Math.abs(res - j.c) - 22 * j.w;
    if (score < bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return oct * 1200 + best.c;
}
