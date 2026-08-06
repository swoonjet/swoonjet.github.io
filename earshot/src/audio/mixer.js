// The mixer.
//
// One strip per place. A strip carries both the live stream from that microphone
// and the layers the piece generates *from* that microphone, so a fader moves a
// place as a whole rather than splitting it in two.
//
// Nothing here touches the analysis. The analyser and the capture buffer tap the
// source node directly, upstream of every control in this file, so mixing changes
// what you hear and never what the piece thinks it is hearing. Pull a fader to
// nothing and the spectrogram, the pattern matching and the narration carry on.

import { clamp } from '../core/util.js';
import { dbToGain, fadeIn } from './levels.js';
import { CONFIG } from '../core/config.js';

const OFF_LOWCUT = 20;      // below the streams' content: effectively bypassed
const OFF_TONE = 19000;     // above it: effectively bypassed

export class ChannelStrip {
  /**
   * @param ctx        AudioContext
   * @param source     the channel's unity-gain source node
   * @param buses      { world, response, reverb } destination nodes
   */
  constructor(ctx, source, buses) {
    this.ctx = ctx;
    this.buses = buses;

    this.state = {
      level: 1,
      pan: 0,
      muted: false,
      soloed: false,
      lowcutHz: OFF_LOWCUT,
      toneHz: OFF_TONE,
      reverb: 0.12,
    };

    // --- the live stream from the place
    this.lowcut = ctx.createBiquadFilter();
    this.lowcut.type = 'highpass';
    this.lowcut.frequency.value = OFF_LOWCUT;
    this.lowcut.Q.value = 0.7;

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = OFF_TONE;
    this.tone.Q.value = 0.7;

    // Level matching sits here, upstream of the fader and of the reverb send, so
    // a place arrives at the mixer already comparable and the fader still means
    // what it says. It is the engine's to move, not the listener's — which is why
    // it is a separate node from `liveLevel` rather than folded into it.
    this.matchGain = ctx.createGain();
    this.matchDb = 0;

    // The fade a place arrives on. Deliberately here and not on the stream itself:
    // the stream's node feeds the analyser, so fading THAT would fade the piece's
    // hearing too — the adaptive floor would latch onto a level eighty decibels low
    // on its first frame and spend twelve seconds correcting, flashing the plot on
    // the way. The analysis should see the place as it really is from the start; it
    // is only the ears that need easing in.
    //
    // A strip is built exactly when a place joins, so this covers the four that
    // arrive at boot, one added from the library, and a whole new random spread.
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;

    this.panner = ctx.createStereoPanner();
    this.liveLevel = ctx.createGain();

    source.connect(this.lowcut);
    this.lowcut.connect(this.tone);
    this.tone.connect(this.matchGain);
    this.matchGain.connect(this.fade);
    this.fade.connect(this.panner);
    this.panner.connect(this.liveLevel);
    this.liveLevel.connect(buses.world);

    // --- the layers generated from this place. Synth voices connect here.
    this.responseIn = ctx.createGain();
    this.responseHP = ctx.createBiquadFilter();
    this.responseHP.type = 'highpass';
    this.responseHP.frequency.value = 42; // the low end belongs to the room
    this.responseLevel = ctx.createGain();

    this.responseIn.connect(this.responseHP);
    this.responseHP.connect(this.responseLevel);
    this.responseLevel.connect(buses.response);

    // --- one shared generated space, fed by both
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = this.state.reverb;
    this.panner.connect(this.reverbSend);
    this.responseHP.connect(this.reverbSend);
    this.reverbSend.connect(buses.reverb);

    this.applyGains(false);
    fadeIn(this.fade.gain, ctx, CONFIG.audio.fadeInSec);
  }

  /** Ramped, never stepped: a fader jump is a click. */
  ramp(param, value, seconds = 0.05) {
    const now = this.ctx.currentTime;
    param.setTargetAtTime(value, now, Math.max(0.005, seconds / 3));
  }

  set(key, value) {
    switch (key) {
      case 'level':
        this.state.level = clamp(value, 0, 1.5);
        break;
      case 'pan':
        this.state.pan = clamp(value, -1, 1);
        this.ramp(this.panner.pan, this.state.pan, 0.08);
        break;
      case 'lowcutHz':
        this.state.lowcutHz = clamp(value, OFF_LOWCUT, 600);
        this.ramp(this.lowcut.frequency, this.state.lowcutHz, 0.08);
        break;
      case 'toneHz':
        this.state.toneHz = clamp(value, 500, OFF_TONE);
        this.ramp(this.tone.frequency, this.state.toneHz, 0.08);
        break;
      case 'reverb':
        this.state.reverb = clamp(value, 0, 1);
        this.ramp(this.reverbSend.gain, this.state.reverb, 0.1);
        break;
      case 'muted':
        this.state.muted = Boolean(value);
        break;
      case 'soloed':
        this.state.soloed = Boolean(value);
        break;
      default:
        return false;
    }
    return true;
  }

  /**
   * The engine's makeup gain for this place, in dB. Ramped over seconds: at this
   * speed a stream that gets quieter for a while is followed, not chased.
   */
  setMatchDb(db, seconds = CONFIG.audio.levelMatch.rampSec) {
    this.matchDb = db;
    this.ramp(this.matchGain.gain, dbToGain(db), seconds);
    return db;
  }

  /**
   * Effective gain. Solo is subtractive — when anything is soloed, everything that
   * is not soloed goes quiet — which is the behaviour a fader-user expects.
   */
  applyGains(soloActive) {
    const audible = !this.state.muted && (!soloActive || this.state.soloed);
    const g = audible ? this.state.level : 0;
    this.ramp(this.liveLevel.gain, g, 0.08);
    this.ramp(this.responseLevel.gain, g, 0.08);
    return audible;
  }

  /** True if any control is away from its default — used to mark a touched strip. */
  get isTouched() {
    const s = this.state;
    return s.level !== 1 || s.pan !== 0 || s.muted || s.soloed
      || s.lowcutHz !== OFF_LOWCUT || s.toneHz !== OFF_TONE;
  }

  reset() {
    this.set('level', 1);
    this.set('pan', 0);
    this.set('lowcutHz', OFF_LOWCUT);
    this.set('toneHz', OFF_TONE);
    this.set('reverb', 0.12);
    this.set('muted', false);
    this.set('soloed', false);
  }

  dispose() {
    for (const node of [this.lowcut, this.tone, this.matchGain, this.fade, this.panner, this.liveLevel,
      this.responseIn, this.responseHP, this.responseLevel, this.reverbSend]) {
      try { node.disconnect(); } catch { /* already gone */ }
    }
  }
}

export const MIXER_DEFAULTS = { OFF_LOWCUT, OFF_TONE };

/**
 * Pan each place by where it actually is.
 *
 * The set is chosen to be spread across the planet, so longitude is a real and
 * freely available stereo axis: the westmost microphone goes left, the eastmost
 * right, the rest in between. It is the one piece of automation here that says
 * something true about the material.
 */
export function panByLongitude(channels) {
  const placed = channels.filter((c) => Number.isFinite(c.meta?.lng));
  if (placed.length < 2) return 0;
  const lngs = placed.map((c) => c.meta.lng);
  const min = Math.min(...lngs);
  const max = Math.max(...lngs);
  const span = max - min || 1;
  const width = CONFIG.audio.geoPanWidth;
  for (const c of placed) {
    const t = (c.meta.lng - min) / span;      // 0 = westmost, 1 = eastmost
    c.strip?.set('pan', (t * 2 - 1) * width);
  }
  return placed.length;
}
