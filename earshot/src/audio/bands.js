// FFT bins -> log-spaced bands. Pure maths, no Web Audio types, so this file
// runs unchanged under Node for the tests.

import { clamp } from '../core/util.js';

/**
 * Build the bin ranges for `bands` log-spaced bands between fMin and fMax.
 * Each entry is [startBin, endBin) and is guaranteed to be at least one bin wide.
 */
export function makeBandEdges({ bands, fMin, fMax, sampleRate, fftSize }) {
  const binHz = sampleRate / fftSize;
  const nyquistBin = fftSize / 2;
  const edges = [];
  const logMin = Math.log(fMin);
  const logMax = Math.log(Math.min(fMax, sampleRate / 2));
  let prev = Math.max(1, Math.floor(fMin / binHz));

  for (let i = 0; i < bands; i++) {
    const hi = Math.exp(logMin + ((i + 1) / bands) * (logMax - logMin));
    let end = Math.min(nyquistBin, Math.ceil(hi / binHz));
    if (end <= prev) end = prev + 1;
    edges.push([prev, Math.min(end, nyquistBin)]);
    prev = edges[i][1];
  }
  return edges;
}

/** Centre frequency of each band, for labelling the axis. */
export function bandCentres(edges, sampleRate, fftSize) {
  const binHz = sampleRate / fftSize;
  return edges.map(([a, b]) => ((a + b) / 2) * binHz);
}

/**
 * Reduce a dB spectrum (Float32Array from getFloatFrequencyData) to normalised
 * band energies in 0..1. Peak-per-band rather than mean: transient detail in a
 * wide high band survives instead of being averaged into the floor.
 */
export function reduceToBands(dbSpectrum, edges, out, floorDb, ceilDb, tiltDb = null, peaksOut = null) {
  const span = ceilDb - floorDb;
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    let peak = -Infinity;
    for (let k = a; k < b; k++) if (dbSpectrum[k] > peak) peak = dbSpectrum[k];
    // The dB reading before anything is done to it, INCLUDING before the
    // substitution below. A channel that decides its own window has to see what it
    // is deciding about: hand it the floor in place of -Infinity and a stream with
    // no audio at all reports itself as sitting exactly on the floor, which is a
    // measurement of the configuration rather than of the world.
    if (peaksOut) peaksOut[i] = peak;
    if (!isFinite(peak)) peak = floorDb;
    // Tilt is applied to the reading, not the floor: silence stays silent.
    const lifted = peak <= floorDb ? floorDb : peak + (tiltDb ? tiltDb[i] : 0);
    out[i] = clamp((lifted - floorDb) / span, 0, 1);
  }
  return out;
}

/**
 * A display tilt, in dB per octave.
 *
 * Natural sound falls away with frequency at roughly 1/f, so on a flat
 * spectrogram all the visible energy piles into the low bands and the whole plot
 * hugs the left-hand edge — the top four octaves are present but too quiet to
 * cross the drawing threshold. This compensates, so the full spectrum is
 * actually used.
 *
 * It only ever boosts: below refHz the offset is zero, so low-frequency material
 * is left exactly as it is rather than being scooped out.
 */
export function makeTiltDb(edges, sampleRate, fftSize, dbPerOctave, refHz = 250, maxDb = 24) {
  const centres = bandCentres(edges, sampleRate, fftSize);
  const tilt = new Float32Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    const octaves = Math.log2(Math.max(centres[i], 1) / refHz);
    tilt[i] = clamp(octaves * dbPerOctave, 0, maxDb);
  }
  return tilt;
}
