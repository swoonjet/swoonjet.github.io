import { clamp, lerp } from './util.js';
import { rung } from './palette.js';
import { FAMILIES } from './voices.js';

// Partial ratios of an ideal struck bar. Blended against the harmonic series so
// `inharmonicity` slides a voice from "pitched" to "metal wind chime".
const BAR = [1, 2.756, 5.404, 8.933, 13.34, 18.64];
const HARM = [1, 2, 3, 4, 5, 6];

function satCurve(k) {
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

// Procedural impulse response: noise under a decaying envelope, one-pole
// lowpassed so the tail is soil-damp rather than glassy.
function makeIR(ctx, seconds, decayPow) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let z = 0;
    const damp = 0.42 + ch * 0.04;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = Math.pow(1 - t, decayPow) * (1 - Math.exp(-i / (sr * 0.006)));
      z += ((Math.random() * 2 - 1) - z) * damp;
      d[i] = z * env;
    }
  }
  return buf;
}

function makeNoise(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
  return buf;
}

// Flat, non-decaying noise for sustained blown voices.
function makeBreath(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let z = 0;
  for (let i = 0; i < n; i++) {
    z += ((Math.random() * 2 - 1) - z) * 0.55; // gently pink it
    d[i] = z * 1.6;
  }
  return buf;
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.maxVoices = 26;
    this.bedFade = 1.1; // seconds to duck, re-pitch and return a bed slot
    this.ready = false;
  }

  /**
   * @param externalCtx pass an OfflineAudioContext to render the instrument
   *   instead of playing it — used by test/audio-render.html to measure output.
   */
  async start(externalCtx) {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    const ctx = externalCtx || new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.offline = !!externalCtx;

    const out = ctx.createGain();
    if (this.offline) {
      out.gain.value = 0.78;
    } else {
      out.gain.value = 0.0;
      out.gain.setTargetAtTime(0.78, ctx.currentTime, 1.2); // fade the world in
    }

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 26;
    comp.ratio.value = 4;
    comp.attack.value = 0.006;
    comp.release.value = 0.3;

    const shaper = ctx.createWaveShaper();
    shaper.curve = satCurve(1.9);
    shaper.oversample = '2x';

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 40;

    // The spirit axis lives here: grounded closes the tilt, ascendant opens it.
    const tilt = ctx.createBiquadFilter();
    tilt.type = 'lowpass';
    tilt.frequency.value = 3000;
    tilt.Q.value = 0.5;

    tilt.connect(shaper);
    shaper.connect(hp);
    hp.connect(comp);
    comp.connect(out);
    out.connect(ctx.destination);

    const dry = ctx.createGain();
    dry.gain.value = 0.9;
    dry.connect(tilt);

    const wetIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeIR(ctx, 3.4, 2.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    wetIn.connect(conv);
    conv.connect(wet);
    wet.connect(tilt);

    this.out = out;
    this.tilt = tilt;
    this.dry = dry;
    this.wetIn = wetIn;
    this.wet = wet;
    this.noise = makeNoise(ctx, 0.12);
    this.breath = makeBreath(ctx, 2.5);

    this._buildWaves();
    this._buildBed();
    this.ready = true;
  }

  /**
   * A bank of PeriodicWaves morphing triangle → square, as a Fourier lerp.
   *   triangle: odd harmonics, 8/(π²n²), sign alternating
   *   square:   odd harmonics, 4/(πn),   sign constant
   * A body's `temper` picks a rung. Soft bells are triangle-wave and glassy;
   * a hard-driven body squares up and starts to reed.
   */
  _buildWaves() {
    const N = 40;
    const count = 6;
    this.waves = [];
    for (let s = 0; s < count; s++) {
      const temper = s / (count - 1);
      const real = new Float32Array(N);
      const imag = new Float32Array(N);
      for (let n = 1; n < N; n += 2) {
        const k = (n - 1) / 2;
        const tri = ((8 / (Math.PI * Math.PI)) * (k % 2 === 0 ? 1 : -1)) / (n * n);
        const sq = 4 / (Math.PI * n);
        imag[n] = lerp(tri, sq, temper);
      }
      this.waves.push(this.ctx.createPeriodicWave(real, imag));
    }
  }

  waveFor(temper) {
    return this.waves[rung(temper, this.waves.length)];
  }

  // A quiet sustained bed that tracks whatever the network has reinforced most.
  // It is what makes an idle network feel like it is still breathing.
  _buildBed() {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 760;
    lp.Q.value = 0.7;
    lp.connect(this.dry);
    const bedSend = ctx.createGain();
    bedSend.gain.value = 0.3; // the bed barely goes to the reverb
    lp.connect(bedSend);
    bedSend.connect(this.wetIn);
    this.bedFilter = lp;
    this.bed = [];
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine'; // triangle waves up here read as reedy, not as air
      osc.frequency.value = 110 * (i + 1);
      osc.detune.value = (i - 1.5) * 5;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = (i / 3) * 1.4 - 0.7;
      osc.connect(g);
      g.connect(pan);
      pan.connect(lp);
      osc.start();
      this.bed.push({ osc, g });
    }
  }

  /**
   * Retune the bed by CROSSFADE, never by portamento.
   *
   * Sliding four sustained oscillators between arbitrary pitches over 1.4s is
   * a siren: measured, it tripled the share of output energy sitting in the
   * 300–1500 Hz band. So a slot that wants a genuinely different note ducks to
   * silence, re-pitches while inaudible, and fades back in. The drone still
   * follows the network — it just changes note instead of wailing between them.
   */
  setBed(freqs, amp) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.bed.length; i++) {
      const b = this.bed[i];
      // the bed lives strictly under the bells
      const target = freqs[i] ? clamp(freqs[i], 40, 200) : 0;
      const level = target && amp > 0.001 ? (amp * 0.28) / (i * 0.75 + 1) : 0;

      if (!level) {
        b.g.gain.setTargetAtTime(0, now, 2.4);
        continue;
      }
      if (!b.hz) {
        b.osc.frequency.setValueAtTime(target, now);
        b.hz = target;
      } else if (
        now >= (b.readyAt ?? 0) &&
        Math.abs(1200 * Math.log2(target / b.hz)) > 40 // a real note change
      ) {
        b.g.gain.cancelScheduledValues(now);
        b.g.gain.setTargetAtTime(0, now, this.bedFade * 0.32);
        b.osc.frequency.setValueAtTime(target, now + this.bedFade);
        b.hz = target;
        b.readyAt = now + this.bedFade;
      }
      if (now >= (b.readyAt ?? 0)) b.g.gain.setTargetAtTime(level, now, 1.8);
    }
  }

  // spirit: -1 grounded .. +1 ascendant
  setSpirit(spirit) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const u = (spirit + 1) / 2;
    this.tilt.frequency.setTargetAtTime(lerp(1250, 9500, u * u), now, 0.35);
    this.wet.gain.setTargetAtTime(lerp(0.3, 0.68, u), now, 0.5);
    this.bedFilter.frequency.setTargetAtTime(lerp(420, 1100, u), now, 0.6);
  }

  activeCount() {
    if (!this.ready) return 0;
    const now = this.ctx.currentTime;
    return this.voices.filter((v) => v.endTime > now).length;
  }

  /**
   * Retire finished voices and make room for a new one. Returns false if the
   * pool is full of voices that have all already been stolen.
   *
   * Stolen voices are spliced out of the pool immediately, not merely marked
   * with a nearer endTime — several strikes can land inside one frame, during
   * which ctx.currentTime does not advance, so a time-based retirement never
   * fires and the pool grows without bound.
   */
  /** Drop finished voices and detach their node chains from the graph. */
  _retire() {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => {
      if (v.endTime <= now) {
        try {
          v.bus.disconnect();
        } catch (e) {
          /* already gone */
        }
        return false;
      }
      return true;
    });
  }

  /**
   * Called from the frame loop. Retirement has to happen on a clock rather than
   * only when a voice is struck: a colony that falls quiet stops striking, and
   * every finished voice would otherwise keep its gain/filter/panner chain
   * attached to the graph forever.
   *
   * This retires but never steals — stealing is only ever correct when making
   * room for a new voice, not when the pool is legitimately full of sound.
   */
  tick() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - (this._lastRetire ?? -1) < 0.25) return;
    this._lastRetire = now;
    this._retire();
  }

  _prune() {
    this._retire();

    let guard = 0;
    while (this.voices.length >= this.maxVoices && guard++ <= this.maxVoices) {
      // steal the quietest voice, never the oldest — this kills a background
      // resonance before it kills the note you just played
      let idx = -1;
      for (let i = 0; i < this.voices.length; i++) {
        if (idx < 0 || this.voices[i].amp < this.voices[idx].amp) idx = i;
      }
      if (idx < 0) break;
      const v = this.voices.splice(idx, 1)[0];
      v.amp = 0;
      try {
        v.bus.gain.cancelScheduledValues(now);
        v.bus.gain.setTargetAtTime(0, now, 0.012);
        for (const o of v.oscs) o.osc.stop(now + 0.05);
      } catch (e) {
        /* already stopping */
      }
    }
    return this.voices.length < this.maxVoices;
  }

  /**
   * Output chain shared by every voice family: pan → level → dry + reverb.
   *
   * `stereo` is per-SOUND, not a global effect: {swirl 0..1, spin -1..1} comes
   * from how the cursor was actually moving when the note fired. Swirl adds an
   * orbiting auto-pan and a ping-pong delay that bounces in the direction you
   * stirred, so each note carries the gesture that made it.
   */
  chain(pan, depth, amp, stereo) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pn = ctx.createStereoPanner();
    pn.pan.value = clamp(pan ?? 0, -1, 1);
    const busOut = ctx.createGain();
    busOut.gain.value = amp;
    pn.connect(busOut);
    busOut.connect(this.dry);
    const send = ctx.createGain();
    send.gain.value = 0.26 + Math.abs(depth ?? 0) * 0.5;
    busOut.connect(send);
    send.connect(this.wetIn);

    const swirl = clamp(stereo?.swirl ?? 0, 0, 1);
    const spin = clamp(stereo?.spin ?? 0, -1, 1);
    if (swirl > 0.04) {
      // orbit: the note's own pan sweeps, the way the cursor was turning
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.35 + swirl * 3.4;
      const depthG = ctx.createGain();
      // sign of spin decides which way round it goes
      depthG.gain.value = (spin >= 0 ? 1 : -1) * swirl * 0.55;
      lfo.connect(depthG);
      depthG.connect(pn.pan);
      lfo.start(now);
      lfo.stop(now + 8);

      // ping-pong: two cross-fed delays hard-panned opposite. Delay times sit
      // well above one render block, so the cross-feedback loop is legal.
      const time = 0.13 + (1 - swirl) * 0.13;
      const dA = ctx.createDelay(0.5);
      const dB = ctx.createDelay(0.5);
      dA.delayTime.value = time;
      dB.delayTime.value = time * 1.35;
      const fbA = ctx.createGain();
      const fbB = ctx.createGain();
      fbA.gain.value = 0.36 + swirl * 0.18;
      fbB.gain.value = 0.36 + swirl * 0.18;
      const pA = ctx.createStereoPanner();
      const pB = ctx.createStereoPanner();
      // stirring one way puts the first bounce left, the other way right
      pA.pan.value = spin >= 0 ? -1 : 1;
      pB.pan.value = spin >= 0 ? 1 : -1;
      const wet = ctx.createGain();
      wet.gain.value = swirl * 0.62;

      pn.connect(dA);
      dA.connect(pA);
      pA.connect(wet);
      dA.connect(fbA);
      fbA.connect(dB);
      dB.connect(pB);
      pB.connect(wet);
      dB.connect(fbB);
      fbB.connect(dA);
      wet.connect(busOut);
      // let the tails die rather than ringing on under later notes
      fbA.gain.setTargetAtTime(0, now + 2.2, 0.6);
      fbB.gain.setTargetAtTime(0, now + 2.2, 0.6);
    }

    return { pn, busOut };
  }

  /** A soft lowpassed noise thump — a mallet's contact, not a stick's click. */
  thump(dest, t, level, cutoff, life) {
    if (!(level > 0.01)) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clamp(cutoff, 200, 4000);
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level * 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + life);
    src.connect(lp);
    lp.connect(g);
    g.connect(dest);
    src.start(t);
  }

  /**
   * Strike a voice from the library. `family` picks the synthesis; `shape`
   * carries the body's geometry and moves the character within that family.
   */
  strike(p) {
    if (!this.ready) return null;
    if (!this.offline && this.ctx.state !== 'running') return null;
    if (!(p.hz > 20) || p.hz > 9000 || !(p.amp > 0.004)) return null;
    if (!this._prune()) return null;
    const make = FAMILIES[p.family] ?? FAMILIES.bar;
    return make(this, {
      decay: 1.4,
      donk: 1.1,
      donkT: 0.05,
      chorus: 8,
      sub: 0.25,
      wood: 0.35,
      bright: 0.35,
      q: 2.4,
      cutoff: 5,
      attack: 0.012,
      temper: 0,
      pan: 0,
      depth: 0,
      ...p,
      shape: p.shape ?? { size: 0.5, skew: 0, spike: 0 },
      // AFTER the spread, or p.amp overwrites it and the trim is dead code
      amp: p.amp * (p.trim ?? 1),
    });
  }

  /**
   * A struck membrane, for when two bodies collide. Three layers: a pitch-drop
   * body (the classic tom/kick fall), a filtered noise click for the contact,
   * and a resonant noise skin. Pitch comes from the colliding bodies' combined
   * size, so a big pair thuds low and a small pair snaps.
   */
  drum({ hz, amp = 0.6, decay = 0.34, tone = 0.5, pan = 0, depth = 0 }) {
    if (!this.ready) return null;
    if (!this.offline && this.ctx.state !== 'running') return null;
    if (!(hz > 15) || amp <= 0.01) return null;
    if (!this._prune()) return null;

    const ctx = this.ctx;
    const t = ctx.currentTime + 0.002;

    const bus = ctx.createGain();
    // drums run hotter than bells so a collision lands level with the chimes
    // rather than 5 dB under them
    bus.gain.value = amp * 1.5;
    const pn = ctx.createStereoPanner();
    pn.pan.value = clamp(pan, -1, 1);
    bus.connect(pn);
    pn.connect(this.dry);
    const send = ctx.createGain();
    send.gain.value = 0.12 + Math.abs(depth) * 0.3; // drums sit drier than bells
    pn.connect(send);
    send.connect(this.wetIn);

    // body — falls a bit under two octaves into its fundamental
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hz * 2.9, t);
    osc.frequency.exponentialRampToValueAtTime(hz, t + 0.058);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(1, t + 0.003);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(bg);
    bg.connect(bus);
    osc.start(t);
    osc.stop(t + decay + 0.05);

    // contact click
    const click = ctx.createBufferSource();
    click.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1100;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.22 * tone, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
    click.connect(hp);
    hp.connect(cg);
    cg.connect(bus);
    click.start(t);

    // skin ring
    const skin = ctx.createBufferSource();
    skin.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = clamp(hz * 3.6, 90, 5000);
    bp.Q.value = 1.5;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.26 * tone, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1 + decay * 0.25);
    skin.connect(bp);
    bp.connect(sg);
    sg.connect(bus);
    skin.start(t);

    const handle = {
      bus,
      amp,
      baseHz: hz,
      oscs: [{ osc, ratio: 1 }], // so a stolen drum can be stopped as well
      endTime: t + decay + 0.12,
      bend() {},
    };
    this.voices.push(handle);
    return handle;
  }

  /**
   * Duck rather than stop, so the colony is still audible behind the title —
   * stepping back from the instrument, not switching it off.
   */
  duck(on) {
    if (!this.ready) return;
    this.out.gain.setTargetAtTime(on ? 0.15 : 0.78, this.ctx.currentTime, 0.45);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
}
