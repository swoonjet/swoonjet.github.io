// Per-channel spectrogram: a ring of log-band frames. This is the shared truth —
// the visualiser reads the same rows the analysis reads.

import { makeBandEdges, reduceToBands, makeTiltDb } from './bands.js';
import { windowFor } from './levels.js';
import { CONFIG } from '../core/config.js';
import { percentile, Smoother } from '../core/util.js';

export class Spectrogram {
  constructor({ bands, rows, sampleRate, fftSize, fMin, fMax }) {
    this.bands = bands;
    this.rows = rows;
    this.edges = makeBandEdges({ bands, fMin, fMax, sampleRate, fftSize });
    this.tiltDb = makeTiltDb(
      this.edges, sampleRate, fftSize,
      CONFIG.audio.tiltDbPerOctave, CONFIG.audio.tiltRefHz,
    );
    this.data = new Float32Array(bands * rows); // row-major, ring on rows
    this.head = 0;                              // row index of the newest frame
    this.frame = new Float32Array(bands);       // newest frame
    this.prev = new Float32Array(bands);
    this.peaks = new Float32Array(bands);       // this frame in dB, before any window
    this.flux = 0;
    this.filled = 0;
    this.gain = 1;      // adaptive trim, set by the engine
    this.rawPeak = 0;   // loudest band before trim — what the trim reacts to

    // What this place is like, in absolute dB, measured continuously. The window
    // below follows `quietDb`; the audible level match follows `loudDb`. Both are
    // rank statistics, so a passing lorry moves neither of them much.
    this.quiet = new Smoother(CONFIG.audio.adaptiveFloor.halfLifeSec, CONFIG.audio.noiseFloorDb);
    this.loudness = new Smoother(CONFIG.audio.levelMatch.halfLifeSec, CONFIG.audio.noiseFloorDb);
    this.measured = false;   // false until the first real frame has been seen
    this.quietDb = CONFIG.audio.noiseFloorDb;
    this.loudDb = -Infinity;
    this.floorDb = CONFIG.audio.noiseFloorDb;
    this.ceilDb = CONFIG.audio.ceilingDb;
    this.floorOffsetDb = 0;  // how far this place's window has slid down
  }

  /** Push a dB spectrum; returns the reduced band frame. */
  push(dbSpectrum) {
    this.prev.set(this.frame);
    reduceToBands(
      dbSpectrum,
      this.edges,
      this.frame,
      this.floorDb,
      this.ceilDb,
      this.tiltDb,
      this.peaks,
    );
    // Measure this frame in absolute dB and re-aim the window for the next one.
    // Deliberately one frame behind: a window that reacted to the frame it was
    // measuring from would be chasing itself.
    this.measureLevels();

    // Measure before trimming, so the trim reacts to the place and not to itself.
    let raw = 0;
    for (let i = 0; i < this.bands; i++) if (this.frame[i] > raw) raw = this.frame[i];
    this.rawPeak = raw;

    if (this.gain !== 1) {
      const g = this.gain;
      for (let i = 0; i < this.bands; i++) {
        const v = this.frame[i] * g;
        this.frame[i] = v > 1 ? 1 : v;
      }
    }

    // Half-wave-rectified spectral flux: only growth counts as onset evidence.
    let flux = 0;
    for (let i = 0; i < this.bands; i++) {
      const d = this.frame[i] - this.prev[i];
      if (d > 0) flux += d;
    }
    this.flux = flux / this.bands;

    this.head = (this.head + 1) % this.rows;
    this.data.set(this.frame, this.head * this.bands);
    if (this.filled < this.rows) this.filled++;
    return this.frame;
  }

  /**
   * Read this place's own level, and slide its window onto it.
   *
   * Both estimates start by jumping to the first frame they see rather than
   * easing up from the configured default: a hydrophone twenty-five decibels
   * under the assumed floor would otherwise spend the first minute of the piece
   * drawing nothing while the estimate crawled down to it.
   */
  measureLevels() {
    const A = CONFIG.audio;
    const quiet = percentile(this.peaks, A.adaptiveFloor.percentile);
    const loud = percentile(this.peaks, A.levelMatch.percentile);
    // -Infinity everywhere means the analyser has not produced anything yet.
    if (!Number.isFinite(quiet)) return;

    if (!this.measured) {
      this.measured = true;
      this.quiet.value = quiet;
      this.loudness.value = loud;
    }
    const dt = 1 / A.frameHz;
    this.quietDb = this.quiet.push(quiet, dt);
    this.loudDb = this.loudness.push(loud, dt);

    const win = windowFor(this.quietDb, A.adaptiveFloor, A.noiseFloorDb, A.ceilingDb);
    this.floorDb = win.floorDb;
    this.ceilDb = win.ceilDb;
    this.floorOffsetDb = win.offsetDb;
  }

  /** Row `age` frames back from now (0 = newest). */
  rowAt(age) {
    const r = (this.head - age + this.rows * 2) % this.rows;
    return this.data.subarray(r * this.bands, (r + 1) * this.bands);
  }

  valueAt(age, band) {
    const r = (this.head - age + this.rows * 2) % this.rows;
    return this.data[r * this.bands + band];
  }

  /**
   * Copy a rectangular patch of history into a flat array — this is the "shape"
   * the pattern matcher and the motif memory both work on.
   * Returns frames oldest-first.
   */
  patch(ageStart, frameCount, out) {
    const dst = out || new Float32Array(frameCount * this.bands);
    for (let f = 0; f < frameCount; f++) {
      const age = ageStart + (frameCount - 1 - f);
      dst.set(this.rowAt(age), f * this.bands);
    }
    return dst;
  }
}
