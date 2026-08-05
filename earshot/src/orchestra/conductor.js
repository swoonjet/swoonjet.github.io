// The orchestrator.
//
// Watches every channel for events, names their shapes, remembers them, looks
// for coincidences worth reading as a figure, and decides what the piece plays
// back. The rule it works to: respond to relation, not to trigger.

import { CONFIG } from '../core/config.js';
import { clamp, mad, median, Ring, rand01 } from '../core/util.js';
import { describePatch } from '../audio/features.js';
import { classify } from '../analysis/patterns.js';
import { fingerprint, MotifMemory } from '../analysis/motifs.js';
import { relate, TagField } from './associations.js';
import { haversineKm } from '../audio/sources.js';
import { Narrator } from './narrator.js';
import { registerToHz, panFor } from '../audio/synth.js';

/** Per-channel onset / event segmentation over the spectrogram stream. */
class EventDetector {
  constructor(frameHz) {
    this.frameHz = frameHz;
    this.fluxHistory = new Ring(90);
    this.state = 'idle';
    this.frames = 0;
    this.peak = 0;
    this.quiet = 0;
    this.lastEndMs = -1e9;
  }

  /** Returns a frame count when an event has just completed, else 0. */
  step(spectrogram, level, nowMs) {
    const flux = spectrogram.flux;
    this.fluxHistory.push(flux);
    const hist = this.fluxHistory.toArray();
    const threshold = median(hist) + CONFIG.detect.fluxOnsetK * (mad(hist) + 0.0015);
    const floor = CONFIG.detect.levelFloor;

    if (this.state === 'idle') {
      const gapOk = nowMs - this.lastEndMs > CONFIG.detect.minOnsetGapMs;
      if (gapOk && level > floor && flux > threshold) {
        this.state = 'active';
        this.frames = 1;
        this.peak = level;
        this.quiet = 0;
      }
      return 0;
    }

    this.frames++;
    if (level > this.peak) this.peak = level;
    const maxFrames = Math.floor((CONFIG.detect.maxEventMs / 1000) * this.frameHz);
    const minFrames = Math.max(2, Math.floor((CONFIG.detect.minEventMs / 1000) * this.frameHz));

    if (level < Math.max(floor * 0.7, this.peak * CONFIG.detect.releaseRatio)) this.quiet++;
    else this.quiet = 0;

    const ended = this.quiet >= 3 || this.frames >= maxFrames;
    if (!ended) return 0;

    this.state = 'idle';
    this.lastEndMs = nowMs;
    const frames = this.frames;
    this.frames = 0;
    return frames >= minFrames ? frames : 0;
  }
}

/** Kilometres between two events' microphones, or 0 when either has no place. */
function separation(a, b) {
  if (!a?.geo || !b?.geo) return 0;
  return haversineKm(a.geo, b.geo);
}

export class Conductor {
  constructor(engine, synth) {
    this.engine = engine;
    this.synth = synth;
    // Keyed by channel id, not position: microphones are added and removed while
    // the piece runs, and a detector holds mid-event state that belongs to one
    // place only.
    this.detectors = new Map();
    this.memory = new MotifMemory();
    this.tags = new TagField();
    this.narrator = new Narrator();
    this.recent = [];
    this.events = [];
    this.nextId = 1;
    this.lastResponseMs = -1e9;
    this.startedMs = 0;
    this.onEvent = null;
  }

  detectorFor(channel) {
    let d = this.detectors.get(channel.id);
    if (!d) {
      d = new EventDetector(CONFIG.audio.frameHz);
      this.detectors.set(channel.id, d);
    }
    return d;
  }

  /** Forget the state of channels that have left. */
  pruneDetectors() {
    const live = new Set(this.engine.channels.map((c) => c.id));
    for (const id of this.detectors.keys()) {
      if (!live.has(id)) this.detectors.delete(id);
    }
  }

  /** Call once per spectrogram frame. */
  step(nowMs, dt) {
    for (const ch of this.engine.channels) {
      const frames = this.detectorFor(ch).step(ch.spectrogram, ch.level, nowMs);
      if (frames) this.completeEvent(ch, frames, nowMs);
    }
    if (this.detectors.size > this.engine.channels.length) this.pruneDetectors();
    this.narrator.update(nowMs, dt);
    this.recent = this.recent.filter((e) => nowMs - e.timeMs < CONFIG.orchestra.coincidenceMs
      && this.engine.channels.includes(e.channelRef));
  }

  completeEvent(channel, frames, nowMs) {
    const sg = channel.spectrogram;
    const patch = sg.patch(0, Math.min(frames, sg.rows));
    const desc = describePatch(patch, sg.bands, Math.min(frames, sg.rows), CONFIG.audio.frameHz);
    if (desc.peak < CONFIG.detect.minPeak) return;

    const match = classify(desc, CONFIG.detect.minConfidence);
    const fp = fingerprint(patch, sg.bands, Math.min(frames, sg.rows));

    const event = {
      id: this.nextId++,
      channel: channel.index,
      channelRef: channel,
      place: channel.meta?.remote ? channel.meta.city : null,
      geo: Number.isFinite(channel.meta?.lat) ? { lat: channel.meta.lat, lng: channel.meta.lng } : null,
      patternId: match.id,
      pattern: match.pattern,
      alt: match.alt?.pattern ?? null,
      confidence: match.confidence,
      desc,
      fingerprint: fp,
      timeMs: nowMs,
      window: {
        duration: desc.duration,
        ageSeconds: desc.duration + 0.12,
        centreHz: registerToHz(desc.centroidMean),
      },
    };

    const seen = this.memory.observe(fp, desc, nowMs, {
      patternId: match.id,
      channel: channel.index,
    });
    event.motif = seen.motif;
    event.isReturn = seen.isReturn;
    event.similarity = seen.similarity;

    this.tags.add(event.pattern.tags ?? [], nowMs, 0.6 + event.confidence * 0.6);
    this.events.push(event);
    if (this.events.length > 400) this.events.shift();
    this.onEvent?.(event);

    // A returning shape takes priority: the piece answers its own character.
    if (seen.isReturn && seen.variation) {
      this.narrator.writeReturn(seen.motif, seen.variation, event, nowMs);
      this.synth.motifVariation(channel, event.window, seen.variation, {
        gain: 0.26 + this.narrator.tension * 0.12,
      });
      this.lastResponseMs = nowMs;
    }

    // Look for a coincidence to read as a figure.
    const partner = this.findPartner(event, nowMs);
    if (partner && this.narrator.canWriteFigure(nowMs)) {
      const relation = relate(partner.pattern.tags ?? [], event.pattern.tags ?? []);
      relation.distanceKm = separation(partner, event);
      const entry = this.narrator.writeFigure(partner, event, relation, nowMs);
      this.playFigure(partner, event, relation);
      event.figure = entry;
    } else if (!seen.isReturn && this.shouldRespond(event, nowMs)) {
      this.playResponse(event);
      if (event.confidence > 0.6 && rand01(`solo${event.id}`) > 0.55) {
        this.narrator.writeSolo(event, nowMs);
      }
    }

    this.recent.push(event);
  }

  /**
   * The most interesting recent event that is not this one. Confidence matters,
   * but so does distance: a coincidence between two continents is worth more to
   * this piece than a confident one inside a single place.
   */
  findPartner(event, nowMs) {
    const pool = this.recent.filter(
      (e) => e.id !== event.id && nowMs - e.timeMs < CONFIG.orchestra.coincidenceMs,
    );
    if (!pool.length) return null;
    const other = pool.filter((e) => e.channel !== event.channel);
    const from = other.length ? other : pool;
    const score = (e) => e.confidence
      + Math.min(separation(e, event) / 20000, 1) * 0.45;
    return from.reduce((best, e) => (score(e) > score(best) ? e : best), from[0]);
  }

  shouldRespond(event, nowMs) {
    if (!this.synth.available) return false;
    const since = nowMs - this.lastResponseMs;
    const gate = 900 + (1 - event.confidence) * 2600 - this.narrator.tension * 500;
    return since > gate && event.confidence > 0.3;
  }

  /** One event, one answer. The mapping from shape to gesture. */
  playResponse(event) {
    const ch = event.channelRef;
    const { desc } = event;
    const centre = registerToHz(desc.centroidMean);
    const pan = panFor(event);
    const heat = 0.16 + this.narrator.tension * 0.16;
    this.lastResponseMs = event.timeMs;

    switch (event.patternId) {
      case 'bird':
        this.synth.spark(ch, { centre: centre * 0.5, gain: heat, count: 6 });
        this.synth.resonantBloom(ch, { centre: centre * 0.25, ratios: [1, 2, 3.02], gain: heat * 0.7, duration: 5.2, q: 30 });
        break;
      case 'footsteps': {
        const interval = clamp(1 / Math.max(desc.onsetDensity, 0.6), 0.24, 1.1);
        this.synth.grainCloud(ch, {
          count: 7, spread: interval * 7, grain: 0.2, ageFrom: 0.6, ageTo: 2.4,
          rate: 0.62, centre: centre * 0.7, q: 1.4, gain: heat, pan,
        });
        break;
      }
      case 'knock':
        this.synth.resonantBloom(ch, { centre: centre * 0.6, ratios: [1, 2.76, 5.4], gain: heat * 1.1, duration: 3.4, q: 34 });
        break;
      case 'thud':
        this.synth.swell(ch, { duration: 11, gain: heat * 1.1, rate: 0.35, centre: Math.max(60, centre * 0.6) });
        break;
      case 'hum':
        this.synth.swell(ch, { duration: 14, gain: heat, rate: 0.5, centre });
        this.synth.resonantBloom(ch, { centre, ratios: [1, 1.5, 2, 3], gain: heat * 0.5, duration: 12, q: 22 });
        break;
      case 'speech':
        // Deliberately unintelligible: fine grains, scattered, never a replay.
        this.synth.grainCloud(ch, {
          count: 26, spread: 3.4, grain: 0.055, ageFrom: 0.5, ageTo: 4.5,
          rate: 0.78, rateJitter: 0.4, centre: centre * 0.8, q: 2.2, gain: heat * 0.75, pan,
        });
        break;
      case 'laughter':
        this.synth.spark(ch, { centre: centre * 1.4, gain: heat * 0.9, count: 9 });
        this.synth.grainCloud(ch, {
          count: 14, spread: 2.6, grain: 0.12, ageFrom: 0.5, ageTo: 3.2,
          rate: 1.5, rateJitter: 0.3, centre: centre * 2, q: 2, gain: heat * 0.6, pan,
        });
        break;
      case 'wind':
        this.synth.swell(ch, { duration: 16, gain: heat * 0.9, rate: 0.72, centre: centre * 1.2 });
        break;
      case 'rain':
        this.synth.grainCloud(ch, {
          count: 40, spread: 4.5, grain: 0.03, ageFrom: 0.4, ageTo: 5,
          rate: 1.1, rateJitter: 0.5, centre: centre * 1.1, q: 4, gain: heat * 0.5, pan,
        });
        break;
      case 'drip':
        this.synth.resonantBloom(ch, { centre, ratios: [1, 2.4], gain: heat, duration: 6, q: 40 });
        break;
      case 'scrape':
        this.synth.grainCloud(ch, {
          count: 18, spread: 2.2, grain: 0.08, ageFrom: 0.4, ageTo: 2.6,
          rate: 0.9, rateJitter: 0.22, centre, q: 1.6, gain: heat * 0.8, pan,
        });
        break;
      default:
        this.synth.grainCloud(ch, {
          count: 9, spread: 3.2, grain: 0.22, ageFrom: 0.8, ageTo: 4,
          rate: 0.84, centre, q: 1, gain: heat * 0.7, pan,
        });
    }
  }

  /**
   * Two events and a relation. The relation chooses the interval: agreement
   * sounds like agreement, opposition is allowed to stay unresolved.
   */
  playFigure(a, b, relation) {
    const ratios = {
      shared:   [1, 2, 3],
      bridge:   [1, 1.5, 2.25],
      far:      [1, 1.68, 2.52],
      contrast: [1, 1.414, 2.83],
      none:     [1, 1.26, 2.1],
    }[relation.kind] ?? [1, 1.5, 2];

    const centreA = registerToHz(a.desc.centroidMean);
    const centreB = registerToHz(b.desc.centroidMean);
    const centre = Math.sqrt(Math.max(centreA, 40) * Math.max(centreB, 40)) * 0.5;
    const gain = 0.2 + relation.strength * 0.12;

    this.synth.resonantBloom(a.channelRef, {
      centre: clamp(centre, 55, 3000), ratios, gain, duration: 9, q: 24,
    });
    this.synth.swell(b.channelRef, {
      duration: 12, gain: gain * 0.8, rate: relation.kind === 'contrast' ? 0.42 : 0.5,
      centre: clamp(centre * 1.5, 70, 4000),
    });
    this.lastResponseMs = Math.max(a.timeMs, b.timeMs);
  }
}
