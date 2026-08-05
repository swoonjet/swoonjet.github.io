// Loudness normalisation, in dB, kept pure.
//
// The set is chosen to be as far apart as possible, which means it is also as
// unalike as possible: a city square at rush hour and a hydrophone at slack water
// are twenty-five decibels apart before anything is decided about them. Two
// separate normalisations follow from that, and they are not interchangeable:
//
//   1. The WINDOW (`windowFor`) decides what a place's spectrogram looks like.
//      A single absolute floor cannot serve both ends of the set — under the floor
//      every band clamps to zero, and no amount of gain recovers a zero, so a very
//      quiet place draws nothing at all. Each place therefore gets a window of the
//      same *width* slid down onto its own background.
//
//   2. The MATCH (`matchDbFor`) decides what a place sounds like in the mix. This
//      one is a plain makeup gain on the live path and has nothing to do with the
//      drawing: the window has already made every place's picture comparable, so
//      by the time you can see a quiet place you still cannot hear it.
//
// Both are deliberately slow and both are clamped. Neither may run away with a
// stream that has simply gone silent — that way you amplify codec dither and call
// it a place.

import { clamp } from '../core/util.js';

/**
 * The dB window for one place, from an estimate of its own background level.
 *
 * The window keeps the configured *width*, because width is contrast: dropping
 * only the floor and leaving the ceiling where it is would stretch 62 dB of
 * material over 95 and the plot would read flat.
 *
 * The slide is RELATIVE — by how far this place sits from a reference place, not
 * to the place's own percentile. That distinction matters and cost a measurement
 * to find. Putting the floor at the place's own percentile equalises the
 * *fraction* of the plot that draws, which sounds like the same thing and is not:
 * the configured floor sits well below an ordinary stream's percentile, so pinning
 * a quiet place's floor to its percentile draws far less of it than an ordinary
 * place gets. Sliding by the difference reproduces the configured relationship at
 * whatever level the place happens to live.
 *
 * It only ever slides DOWN. A stream at ordinary field-recording level keeps
 * exactly the look it has now, and only the unusually quiet ones are moved. Loud
 * places are already handled elsewhere, by the adaptive trim, which can attenuate.
 *
 * @param quietDb  the place's own background, in dB (a high-ish percentile of its
 *                 band peaks — see CONFIG.audio.adaptiveFloor.percentile)
 * @param cfg      CONFIG.audio.adaptiveFloor
 * @param floorDb  CONFIG.audio.noiseFloorDb — the configured floor, and the ceiling
 *                 of this adjustment
 * @param ceilDb   CONFIG.audio.ceilingDb
 */
export function windowFor(quietDb, cfg, floorDb, ceilDb) {
  const span = ceilDb - floorDb;
  if (!cfg?.enabled || !Number.isFinite(quietDb)) return { floorDb, ceilDb, offsetDb: 0 };
  const belowReference = Math.min(0, quietDb - cfg.referenceDb);
  const wanted = clamp(floorDb + belowReference, cfg.minFloorDb, floorDb);
  return { floorDb: wanted, ceilDb: wanted + span, offsetDb: wanted - floorDb };
}

/**
 * Makeup gain for one place's live path, in dB.
 *
 * Returns null when there is nothing to measure — a silent or dropped stream —
 * which the caller must read as "hold what you have" rather than as 0 dB. A
 * stream that goes quiet for a moment should not be hauled up by 18 dB and then
 * dropped again when it comes back; that is pumping, and it is audible.
 *
 * @param loudDb  a high percentile of the place's band peaks, in dB
 * @param cfg     CONFIG.audio.levelMatch
 */
export function matchDbFor(loudDb, cfg) {
  if (!cfg?.enabled) return 0;
  if (!Number.isFinite(loudDb) || loudDb <= cfg.silenceDb) return null;
  return clamp(cfg.targetDb - loudDb, -cfg.maxCutDb, cfg.maxBoostDb);
}

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-6));
