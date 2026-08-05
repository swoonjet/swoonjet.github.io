// The response layers.
//
// Everything audible here is made from the live capture buffers — grains of the
// room played back seconds later, the room's own signal driven through
// resonators, and a reverb whose impulse is generated at runtime. No sample
// files, no oscillator patches standing in for recordings.

import { CONFIG } from '../core/config.js';
import { clamp, lerp, rand01 } from '../core/util.js';

const SAFE_MARGIN = 0.28; // seconds of live buffer to leave alone near the write head

export class Synth {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.voices = 0;
    this.seed = 1;
  }

  init() {
    // The generated space and the high-pass now live on the engine and on each
    // channel's strip, so a voice made from a place is routed through that
    // place's fader, pan and reverb send rather than a shared output. Pulling a
    // fader down takes the microphone and its echoes with it.
    return this;
  }

  /** Where a voice built from `channel` belongs. */
  outFor(channel) {
    return this.engine.responseInputFor(channel);
  }

  get available() {
    return this.voices < CONFIG.orchestra.maxVoices;
  }

  next() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** A safe read position in a channel's rolling capture. */
  readOffset(channel, ageSeconds) {
    const { ctx } = this;
    const buf = channel.live;
    if (!buf) return null;
    const total = buf.length / ctx.sampleRate;
    const captured = (channel.captured ?? 0) / ctx.sampleRate;
    if (captured < 1.0) return null;

    const usable = Math.min(total, captured) - SAFE_MARGIN;
    const age = clamp(ageSeconds, SAFE_MARGIN, Math.max(SAFE_MARGIN + 0.05, usable));
    const headSec = channel.writeHead / ctx.sampleRate;
    let off = headSec - age;
    while (off < 0) off += total;
    return off % total;
  }

  /**
   * A cloud of grains drawn from the live buffer.
   * spec: { count, spread, grain, ageFrom, ageTo, rate, gain, pan, lowpass, highpass, when }
   */
  grainCloud(channel, spec) {
    const { ctx } = this;
    if (!channel.live || !this.available) return 0;

    const t0 = spec.when ?? ctx.currentTime + 0.02;
    const count = Math.max(1, Math.round(spec.count ?? 12));
    const spread = spec.spread ?? 1.2;
    let spawned = 0;

    for (let i = 0; i < count; i++) {
      const jitter = this.next();
      const when = t0 + (i / count) * spread + jitter * (spread / count) * 0.9;
      const age = lerp(spec.ageFrom ?? 0.6, spec.ageTo ?? 3.0, this.next());
      const offset = this.readOffset(channel, age);
      if (offset == null) break;

      const grain = clamp((spec.grain ?? 0.16) * (0.7 + this.next() * 0.6), 0.02, 2.2);
      const rate = clamp((spec.rate ?? 1) * (1 + (this.next() - 0.5) * (spec.rateJitter ?? 0.03)), 0.12, 6);

      const src = ctx.createBufferSource();
      src.buffer = channel.live;
      src.playbackRate.value = rate;

      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = clamp(spec.centre ?? 700, 60, 15000) * (0.75 + this.next() * 0.6);
      band.Q.value = spec.q ?? 1.1;

      const env = ctx.createGain();
      env.gain.value = 0;

      const pan = ctx.createStereoPanner();
      pan.pan.value = clamp((spec.pan ?? 0) + (this.next() - 0.5) * 0.9, -1, 1);

      src.connect(band); band.connect(env); env.connect(pan); pan.connect(this.outFor(channel));

      const peak = (spec.gain ?? 0.35) * (0.5 + this.next() * 0.7);
      const attack = grain * (spec.attack ?? 0.45);
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, when + grain);

      // duration is in buffer-time, so the audible grain lasts `grain` seconds
      try { src.start(when, offset, grain * rate); } catch { break; }
      src.stop(when + grain + 0.02);
      this.hold(src, grain + 0.1);
      spawned++;
    }
    return spawned;
  }

  /**
   * Drive the live signal through a bank of resonators — the room ringing at
   * pitches drawn from what it just did. Blooms *underneath* the live mix.
   */
  resonantBloom(channel, { centre = 220, ratios = [1, 1.5, 2.02, 2.99], gain = 0.22, duration = 4.5, q = 26, when }) {
    const { ctx } = this;
    if (!this.available) return;
    const t0 = when ?? ctx.currentTime + 0.02;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.outFor(channel));

    for (const r of ratios) {
      const f = clamp(centre * r, 45, 12000);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 1 / (1 + Math.log2(r + 1) * 1.6);
      channel.sourceNode.connect(bp);
      bp.connect(g);
      g.connect(out);
      this.hold({ disconnect: () => { try { channel.sourceNode.disconnect(bp); } catch {} } }, duration + 0.4);
    }

    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(gain, t0 + duration * 0.35);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    this.hold(out, duration + 0.2);
  }

  /**
   * A slow swell: long, heavily overlapped grains, low-passed. The piece
   * breathing rather than speaking.
   */
  swell(channel, { duration = 9, gain = 0.2, rate = 0.5, centre = 180, when }) {
    return this.grainCloud(channel, {
      when,
      count: Math.round(duration * 2.4),
      spread: duration,
      grain: 1.1,
      ageFrom: 1.4,
      ageTo: 7.5,
      rate,
      rateJitter: 0.02,
      centre,
      q: 0.7,
      gain,
      attack: 0.5,
      pan: (this.next() - 0.5) * 0.6,
    });
  }

  /** A short bright answer, up where the sparks are. */
  spark(channel, { centre = 4200, gain = 0.18, when, count = 5 }) {
    return this.grainCloud(channel, {
      when,
      count,
      spread: 0.5,
      grain: 0.06,
      ageFrom: 0.35,
      ageTo: 1.6,
      rate: 1.4,
      rateJitter: 0.25,
      centre,
      q: 3.5,
      gain,
      attack: 0.2,
    });
  }

  /**
   * Replay a remembered window of live audio, altered by the variation ladder.
   * This is how a motif answers itself.
   */
  motifVariation(channel, window, variation, { gain = 0.3, when } = {}) {
    const { ctx } = this;
    if (!channel.live || !this.available) return false;
    const t0 = when ?? ctx.currentTime + 0.05;
    const rate = Math.pow(2, (variation.transpose ?? 0) / 12) / (variation.stretch ?? 1);

    const buffer = variation.reverse
      ? this.reversedSlice(channel, window)
      : channel.live;
    if (!buffer) return false;

    const offset = variation.reverse ? 0 : this.readOffset(channel, window.ageSeconds);
    if (offset == null) return false;
    const bufferDur = variation.reverse ? buffer.duration : window.duration;

    if (variation.blur > 0.5) {
      // Heavily blurred returns become a grain cloud rather than a replay.
      this.grainCloud(channel, {
        when: t0,
        count: Math.round(18 * (variation.density ?? 1)),
        spread: bufferDur * (variation.stretch ?? 1),
        grain: 0.34,
        ageFrom: window.ageSeconds,
        ageTo: window.ageSeconds + window.duration,
        rate,
        rateJitter: 0.12,
        centre: clamp(window.centreHz ?? 600, 80, 9000),
        q: 0.9,
        gain: gain * 0.8,
      });
      return true;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = clamp(window.centreHz ?? 700, 70, 12000);
    filt.Q.value = lerp(2.4, 0.5, clamp(variation.blur ?? 0, 0, 1));

    const env = ctx.createGain();
    env.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (this.next() - 0.5) * 1.2;

    src.connect(filt); filt.connect(env); env.connect(pan); pan.connect(this.outFor(channel));

    const audible = bufferDur / rate;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + Math.min(0.25, audible * 0.3));
    env.gain.setValueAtTime(Math.max(gain, 0.0002), t0 + audible * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + audible);

    try { src.start(t0, variation.reverse ? 0 : offset, bufferDur); } catch { return false; }
    src.stop(t0 + audible + 0.05);
    this.hold(src, audible + 0.2);
    return true;
  }

  /** Copy a window out of the rolling buffer, backwards. */
  reversedSlice(channel, window) {
    const { ctx } = this;
    const sr = ctx.sampleRate;
    const n = Math.floor(clamp(window.duration, 0.05, 3) * sr);
    const start = this.readOffset(channel, window.ageSeconds);
    if (start == null) return null;
    const src = channel.live.getChannelData(0);
    const out = ctx.createBuffer(1, n, sr);
    const d = out.getChannelData(0);
    const s0 = Math.floor(start * sr);
    for (let i = 0; i < n; i++) {
      d[n - 1 - i] = src[(s0 + i) % src.length];
    }
    return out;
  }

  /** Keep a node alive and count it against the voice budget. */
  hold(node, seconds) {
    this.voices++;
    setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1);
      try { node.disconnect?.(); } catch { /* already gone */ }
    }, seconds * 1000);
  }
}

/** Map a normalised register 0..1 onto a musical centre frequency. */
export function registerToHz(register) {
  return 55 * Math.pow(2, clamp(register, 0, 1) * 7.2);
}

/** A deterministic but non-repeating pan for an event. */
export function panFor(event) {
  return clamp(rand01(`${event.patternId}${event.id}`) * 1.7 - 0.85, -1, 1);
}
