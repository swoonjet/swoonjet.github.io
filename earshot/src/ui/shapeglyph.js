// The reference library, drawn.
//
// Every entry in the library is a DESCRIPTION — a register profile, a duration, an
// attack, how noisy it is, how often it repeats — and never a recording. The row
// used to show a progress bar, which said nothing about the shape it was looking
// for and drew a rule line under every entry besides. This builds a small
// spectrogram figure out of the entry's own numbers instead: time across,
// frequency up, and the mark made of whatever the criteria actually say.
//
// Nothing here is invented. Every dimension traces back to a value in patterns.js,
// which is the point — the row shows what the matcher is listening for, so "shapes,
// not samples" is demonstrated rather than asserted.
//
// The scatter inside a mark is deterministic, seeded from the entry's id: these
// glyphs are a surface, not an animation, and a library that redrew itself
// differently on every reload would be lying about being a fixed reference.

import { clamp } from '../core/util.js';

export const BOX = { w: 58, h: 18 };

/** [sub, low, mid, high, top] — the five registers a profile is written in. */
const REGISTERS = 5;

/** A click this short is a transient, and gets the broadband edge that implies. */
const TRANSIENT_S = 0.07;

/** Above this spectral flatness a mark is noise with a width, not a line. */
const NOISE_FLATNESS = 0.42;

/** The span of durations the library covers, and so the span the box maps. */
const SHORTEST_S = 0.03;
const LONGEST_S = 6;

/** The [lo, hi] a entry puts on one criterion, or null when it leaves it free. */
export function range(pattern, key) {
  const row = (pattern.criteria ?? []).find((c) => c[0] === key);
  return row ? [row[1], row[2]] : null;
}

function mid(r) { return r ? (r[0] + r[1]) / 2 : null; }

/** Geometric middle, for spans that cross orders of magnitude — durations, rates. */
function logMid([lo, hi]) {
  const a = Math.max(lo, 1e-4);
  const b = Math.max(hi, a);
  return Math.exp((Math.log(a) + Math.log(b)) / 2);
}

/**
 * Everything the drawing needs, read off one library entry.
 *
 * Separated from the drawing so it can be tested as numbers: a bird sits higher in
 * the box than a thud, rain carries more marks than a single drop, wind is a band
 * and a hum is a line.
 */
export function shapeSpec(pattern, box = BOX) {
  const regs = pattern.registers ?? new Array(REGISTERS).fill(1 / REGISTERS);
  const total = regs.reduce((a, b) => a + b, 0) || 1;

  // Centre of gravity and width of the register profile — where the mark sits in
  // the box, and how tall it is.
  let centre = 0;
  for (let i = 0; i < REGISTERS; i++) centre += i * (regs[i] / total);
  let variance = 0;
  for (let i = 0; i < REGISTERS; i++) variance += ((i - centre) ** 2) * (regs[i] / total);
  const spread = Math.sqrt(variance);

  const band = box.h / REGISTERS;
  const centreY = box.h - (centre + 0.5) * band;
  const half = Math.max(1, spread * band * 0.85);

  const dur = range(pattern, 'duration');
  const durMid = dur ? logMid(dur) : 0.4;
  // Log, because the library spans two and a half decades of time and a linear
  // map would draw everything short as nothing at all.
  const width = clamp(
    box.w * (Math.log(durMid / SHORTEST_S) / Math.log(LONGEST_S / SHORTEST_S)),
    3, box.w,
  );

  const flatness = mid(range(pattern, 'flatnessMean')) ?? 0.15;
  // An onset range that opens at zero is an upper bound — "nothing much happens
  // here" — and belongs to wind and hums, not to a scatter of separate events.
  // Only a floor above zero says the shape genuinely repeats.
  const onsetRange = range(pattern, 'onsetDensity');
  const onset = onsetRange && onsetRange[0] > 0 ? mid(onsetRange) : 0;
  const modHz = mid(range(pattern, 'modulationHz')) ?? 0;
  const slope = mid(range(pattern, 'centroidSlope')) ?? 0;
  const jaggedness = mid(range(pattern, 'jaggedness')) ?? 0;
  const attack = mid(range(pattern, 'attack'));
  const travel = mid(range(pattern, 'centroidRange')) ?? 0;

  // How many separate marks. Onsets are a rate, so the count needs a plain
  // duration rather than the geometric one the width uses — a scatter of
  // footsteps over two seconds is several steps, not one.
  const durSpan = dur ? (dur[0] + dur[1]) / 2 : durMid;
  const marks = onset > 0 ? clamp(Math.round(onset * durSpan), 1, 16) : 1;

  return {
    box,
    centreY,
    half,
    width,
    marks,
    texture: flatness >= NOISE_FLATNESS ? 'noise' : 'tone',
    flatness,
    // A transient's leading edge crosses every register at once.
    transient: marks === 1 && attack !== null && attack < TRANSIENT_S,
    // Voices and laughter modulate; a hum barely does.
    wobble: clamp(modHz / 12, 0, 1) * half * 1.15,
    cycles: clamp(modHz * durMid, 0, 5),
    // A falling centroid (laughter) tilts the mark down as it goes. Written as a
    // condition rather than arithmetic on zero, which would leave a -0 in the spec.
    tilt: slope ? clamp(-slope * 0.3, -0.5, 0.5) * box.h : 0,
    // A cry that sweeps — one arc rather than a wobble.
    arc: travel * box.h * 0.9,
    rough: clamp(jaggedness, 0, 2) * 0.55,
  };
}

/**
 * One library entry as SVG.
 *
 * Strokes only, in `currentColor`, so the row's own colour — idle, matched, or
 * accented — carries straight through from the stylesheet.
 */
export function glyphFor(pattern, box = BOX) {
  const spec = shapeSpec(pattern, box);
  const rnd = seeded(pattern.id ?? 'x');
  const x0 = 0.5;
  const segments = [];

  if (spec.marks > 1) {
    scatter(segments, spec, rnd, x0);
  } else if (spec.texture === 'noise') {
    hiss(segments, spec, rnd, x0);
  } else {
    line(segments, spec, rnd, x0);
  }

  if (spec.transient) {
    // The broadband edge a click opens with, a little taller than the body.
    const h = spec.half * 1.5;
    segments.push(`M${f(x0)} ${f(spec.centreY - h)}V${f(spec.centreY + h)}`);
  }

  return `<svg class="glyph" viewBox="0 0 ${box.w} ${box.h}" width="${box.w}" height="${box.h}"`
    + ` aria-hidden="true" focusable="false">`
    + `<path d="${segments.join('')}" fill="none" stroke="currentColor"`
    + ` stroke-width="1" stroke-linecap="butt" vector-effect="non-scaling-stroke"/>`
    + `</svg>`;
}

/** Repeated events: rain, footsteps. Ticks across the mark's span. */
function scatter(segments, spec, rnd, x0) {
  const { marks, width, centreY, half } = spec;
  const step = marks > 1 ? width / (marks - 1) : width;
  for (let i = 0; i < marks; i++) {
    // Real events do not land on a grid; the jitter is a fraction of the spacing
    // so a dense scatter stays legible and a sparse one stays irregular.
    const x = x0 + i * step + (rnd() - 0.5) * step * 0.45;
    const y = centreY + (rnd() - 0.5) * half * 1.1;
    const h = Math.max(1.6, half * (0.55 + rnd() * 0.7));
    segments.push(`M${f(clamp(x, x0, x0 + width))} ${f(y - h)}V${f(y + h)}`);
  }
}

/** Broadband and sustained: wind, a scrape, the body of a knock. */
function hiss(segments, spec, rnd, x0) {
  const { width, centreY, half, flatness, rough } = spec;
  // Rows need room to read as separate lines. Below about two and a half pixels
  // apart a 1px stroke stops being a band of strokes and becomes a smudge, which
  // is what four rows in eight pixels looked like.
  const rows = clamp(Math.floor((half * 2) / 2.6), 2, 5);
  const gap = (half * 2) / rows;
  for (let r = 0; r < rows; r++) {
    const base = centreY - half + gap * (r + 0.5);
    let x = x0;
    while (x < x0 + width) {
      const run = 2 + rnd() * 4.5;
      // Flatness is how filled the band is: a hiss is nearly solid, a scrape is
      // torn up into shorter strokes with more paper between them.
      if (rnd() < flatness + 0.18) {
        // And jaggedness makes the rows wander. It is the one thing that
        // separates a scrape from wind — both are broadband and sustained, but a
        // scrape is rough over time and wind is not.
        const y = base + (rnd() - 0.5) * rough * 1.8;
        segments.push(`M${f(x)} ${f(y)}H${f(Math.min(x + run, x0 + width))}`);
      }
      x += run + 0.7 + rnd() * 1.8;
    }
  }
}

/** Tonal and continuous: a hum, a voice, a bird's cry. */
function line(segments, spec, rnd, x0) {
  const { width, centreY, wobble, cycles, tilt, arc, rough } = spec;
  const steps = Math.max(4, Math.round(width / 1.6));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = centreY
      + tilt * t
      + wobble * Math.sin(t * cycles * Math.PI * 2)
      // A sweep rises through the middle of its own duration and comes back.
      - arc * Math.sin(t * Math.PI)
      + (rnd() - 0.5) * rough;
    points.push(`${f(x0 + t * width)} ${f(y)}`);
  }
  segments.push(`M${points.join('L')}`);
}

/**
 * A small deterministic generator, seeded by the entry's id.
 *
 * The scatter in these marks has to be identical on every load — a reference that
 * redraws itself differently each time is not a reference. mulberry32, because it
 * is four lines and good enough to place eleven dozen strokes.
 */
export function seeded(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One decimal is plenty at this size, and keeps the markup readable. */
function f(n) {
  return Math.round(n * 10) / 10;
}
