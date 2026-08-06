// Colour combinations as mallet voices.
//
// Every edge belongs to a Fritz channel by pitch class — Flarepop, Coolsweep or
// Wiretree. When a body strikes, the channel of the edge it sounds is paired
// with the channel of whatever that edge is joined to (or its nearest
// neighbour). The six unordered pairs each get their own voice, so a triangle's
// sound is not a property of the triangle: it is a property of the company it is
// keeping. Rewire the colony and its voices change.
//
// Each pair names a `family` from the library in voices.js — a tuned bar, a
// plucked string, a drum head, a singing bowl, a water drop, a blown tone. The
// remaining fields tune that family. Nothing here resonates or screams; the
// whole library is struck, plucked or blown.
//
// The body's SHAPE then moves the character within its family, so dragging a
// triangle's corners is a continuous timbre control on top of a discrete
// instrument choice.
//
// `trim` is a measured per-family level match. Left untrimmed the library spanned
// 30 dB — a plucked string is a feedback loop and a water drop is one short sine,
// so their natural outputs are nowhere near each other.

export const PATCHES = {
  // Flarepop × Flarepop — a bright tuned bar. The clearest ding in the library.
  '0-0': {
    name: 'ding',
    family: 'bar',
    bright: 0.55,
    wood: 0.25,
    donk: 1.06,
    donkT: 0.035,
    q: 2.2,
    cutoff: 8,
    chorus: 6,
    sub: 0.18,
    decay: 1.1,
    attack: 0.009,
    trim: 1.0, // measured level match against the rest of the library
  },
  // Coolsweep × Coolsweep — a hand on a drum head. Soft, pitched, no stick.
  '1-1': {
    name: 'skin',
    family: 'skin',
    decay: 0.9,
    trim: 1.55, // measured level match against the rest of the library
  },
  // Wiretree × Wiretree — a plucked string, decaying physically in a delay loop.
  '2-2': {
    name: 'pluck',
    family: 'pluck',
    decay: 1.6,
    trim: 8, // measured level match against the rest of the library
  },
  // Flarepop × Coolsweep — a water drop. The only voice that bends upward.
  '0-1': {
    name: 'drop',
    family: 'drop',
    decay: 0.34,
    trim: 3.0, // measured level match against the rest of the library
  },
  // Flarepop × Wiretree — a singing bowl. Inharmonic, beating, very long.
  '0-2': {
    name: 'bowl',
    family: 'bowl',
    decay: 2.6,
    trim: 0.45, // measured level match against the rest of the library
  },
  // Coolsweep × Wiretree — a blown tone. Breath, and the one that whistles.
  '1-2': {
    name: 'air',
    family: 'air',
    decay: 1.8,
    trim: 1.3, // measured level match against the rest of the library
  },
};

export function comboKey(a, b) {
  return a <= b ? `${a}-${b}` : `${b}-${a}`;
}

export function patchFor(chA, chB) {
  return PATCHES[comboKey(chA, chB)] ?? PATCHES['0-0'];
}
