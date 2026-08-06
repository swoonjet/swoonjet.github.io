// Fritz hero channels, in their locked roles. Five rungs each, 100 → 500.
// Two rules from the brand kit shape everything in this file:
//   · channel families NEVER blend into each other (Flarepop→Coolsweep would
//     ramp through the banned purple), so every crossing is a hard cut;
//   · no smooth gradients — ramps are hard-edged equal steps.
// STEPS is the one dial: raise it for finer banding, drop it for a blockier read.

import { clamp } from './util.js';

export const STEPS = 5;

export const FLAREPOP = ['#FF00E5', '#DF00BE', '#A8008C', '#700063', '#39003A'];
export const COOLSWEEP = ['#1A7AFF', '#1666D6', '#1251AD', '#0D3D85', '#08285C'];
export const WIRETREE = ['#00D862', '#00B553', '#008F42', '#006632', '#003D1E'];
export const CARBON = ['#3A3A4A', '#2C2C3A', '#1F1F2A', '#14141C', '#0A0A0F'];
export const HALO = ['#FFFFFF', '#F5F7FF', '#E6E9F5', '#D1D6E6', '#B8BED1'];

// Flarepop primary · Coolsweep secondary · Wiretree tertiary
export const CHANNELS = [FLAREPOP, COOLSWEEP, WIRETREE];
export const CHANNEL_NAMES = ['flarepop', 'coolsweep', 'wiretree'];

export const CANVAS = CARBON[4]; // #0A0A0F — page ground

/** Quantise 0..1 onto n hard steps. */
export function step(v, n = STEPS) {
  return Math.round(clamp(v, 0, 1) * (n - 1)) / (n - 1);
}

/** Quantise 0..1 to an integer rung index 0..n-1. */
export function rung(v, n = STEPS) {
  return clamp(Math.round(clamp(v, 0, 1) * (n - 1)), 0, n - 1);
}

/**
 * Pitch class picks the channel — the octave is cut into three, one per channel,
 * with hard boundaries. A chord therefore reads as two or three distinct brand
 * channels rather than as a smear across the colour wheel.
 */
export function channelIndex(cents) {
  const pc = (((cents % 1200) + 1200) % 1200) / 1200;
  return Math.min(2, Math.floor(pc * 3));
}

/**
 * An edge's colour: its channel, stepped down its OWN ramp by how lit it is.
 * Idle sits at rung 3 (visible but recessed on Carbon); a hard strike reaches
 * rung 0, the hero hex itself.
 */
export function edgeHex(cents, energy, active) {
  const ch = CHANNELS[channelIndex(cents)];
  let i = 3 - rung(clamp(energy, 0, 1), 4);
  if (active) i = Math.max(0, i - 1);
  return ch[i];
}

/**
 * The substrate ladder for the gravity axis. Rooted grounds the world in the
 * deepest Flarepop rung, ascendant in the deepest Coolsweep — and the crossing
 * is a hard cut through neutral Carbon, never a magenta-to-blue ramp.
 */
const GROUND = [
  { hex: FLAREPOP[4], a: 1.0 },
  { hex: FLAREPOP[4], a: 0.48 },
  { hex: CARBON[3], a: 0.72 },
  { hex: COOLSWEEP[4], a: 0.48 },
  { hex: COOLSWEEP[4], a: 1.0 },
];

/** spirit −1..+1 → one of five stepped ground states. */
export function ground(spirit) {
  return GROUND[rung((clamp(spirit, -1, 1) + 1) / 2, GROUND.length)];
}

/** The channel the substrate currently belongs to, for tinting field streaks. */
export function groundChannel(spirit) {
  if (spirit < -0.2) return FLAREPOP;
  if (spirit > 0.2) return COOLSWEEP;
  return CARBON;
}
