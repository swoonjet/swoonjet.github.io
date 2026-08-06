// The sound library. Six synthesis families, all struck or plucked or blown —
// nothing here is a synth lead. The colour combination a body is sounding in
// picks the family; the body's SHAPE moves the character within it.
//
// Shape arrives as three 0..1 values and is deliberately kept off pitch, since
// the colony has to stay in tune with the major drone:
//   size  — squat and broad → longer and darker; small → short and bright
//   skew  — how far from equilateral → noise, inharmonicity, detune spread
//   spike — one corner pulled out → thin and bright
//
// Every family returns the same handle shape, so bend() (the siren) and cut()
// (mono retrigger) work identically across the library.

import { clamp, lerp } from './util.js';

/** One bend function for every family, whatever its pitch actually lives on. */
function bendFn(ctx, items) {
  return function bend(cents, glide = 0.09) {
    const now = ctx.currentTime;
    if (now > this.endTime) return;
    const ratio = Math.pow(2, clamp(cents, -4800, 4800) / 1200);
    for (const it of items) {
      if (it.detune) it.detune.setTargetAtTime(clamp(cents, -4800, 4800), now, glide);
      else if (it.freq) it.freq.setTargetAtTime(clamp(it.base * ratio, 20, 18000), now, glide);
      // a delay line's period is the inverse of its pitch
      else if (it.period) it.period.setTargetAtTime(clamp(it.base / ratio, 0.0002, 0.05), now, glide);
    }
  };
}

function finish(eng, chain, items, life, amp, hz) {
  const ctx = eng.ctx;
  const handle = {
    bus: chain.busOut,
    amp,
    baseHz: hz,
    oscs: [],
    span: life,
    endTime: ctx.currentTime + life,
    bend: bendFn(ctx, items),
    cut(tau = 0.012) {
      const now = ctx.currentTime;
      try {
        chain.busOut.gain.cancelScheduledValues(now);
        chain.busOut.gain.setTargetAtTime(0, now, tau);
      } catch (e) {
        /* already gone */
      }
      this.amp = 0;
      this.endTime = Math.min(this.endTime, now + tau * 5);
    },
  };
  eng.voices.push(handle);
  return handle;
}

// ————————————————————————————————————————————————————————————
// bar — a soft mallet on a tuned bar. The marimba: first overtone two octaves
// up at 4x, dying long before the body.
// ————————————————————————————————————————————————————————————
export function voiceBar(eng, p) {
  const ctx = eng.ctx;
  const t = ctx.currentTime + 0.002;
  const { hz, amp, shape } = p;
  const chain = eng.chain(p.pan, p.depth, amp);

  const mix = ctx.createGain();
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.Q.value = clamp(p.q ?? 2.4, 0.4, 4);
  mix.connect(filt);
  filt.connect(chain.pn);

  const dec = p.decay * lerp(0.7, 1.5, shape.size);
  const atk = Math.max(0.004, (p.attack ?? 0.012) * lerp(0.6, 1.5, shape.size));
  const bright = clamp((p.bright ?? 0.35) * lerp(0.5, 1.6, shape.spike), 0, 1.3);
  const dip = 1 + (p.donk - 1) * lerp(0.5, 1.6, shape.size);
  const items = [];
  let life = 0;

  const partial = (freq, level, ratio, wave) => {
    if (level <= 0.005 || freq > 17000) return;
    const o = ctx.createOscillator();
    if (wave === 'morph') o.setPeriodicWave(eng.waveFor(p.temper ?? 0));
    else o.type = wave;
    // skew detunes the partials off true — the bar stops being perfectly tuned
    o.detune.value = (Math.random() * 2 - 1) * shape.skew * 55;
    o.frequency.setValueAtTime(clamp(freq * dip, 20, 18000), t);
    o.frequency.exponentialRampToValueAtTime(clamp(freq, 20, 18000), t + p.donkT);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ratio);
    o.connect(g);
    g.connect(mix);
    o.start(t);
    o.stop(t + ratio + 0.05);
    items.push({ detune: o.detune });
    life = Math.max(life, ratio);
  };

  partial(hz, 0.62, dec, 'morph');
  partial(hz * Math.pow(2, p.chorus / 1200), 0.4, dec * 0.94, 'triangle');
  partial(hz * 4, bright * 0.3, dec * 0.26, 'sine');
  partial(hz * 9.2, bright * 0.07, Math.min(0.12, dec * 0.1), 'sine');
  partial(hz * 0.5, (p.sub ?? 0.25) * 0.5, dec * 1.05, 'sine');

  eng.thump(mix, t, p.wood * lerp(0.7, 1.4, shape.size), clamp(hz * 5, 300, 2600), 0.035);

  const fHi = clamp(hz * p.cutoff * lerp(1.5, 0.55, shape.size), 220, 15000);
  filt.frequency.setValueAtTime(fHi, t);
  filt.frequency.exponentialRampToValueAtTime(clamp(hz * 1.6, 90, 7000), t + Math.max(0.1, dec * 0.6));

  return finish(eng, chain, items, life + 0.06, amp, hz);
}

// ————————————————————————————————————————————————————————————
// pluck — Karplus-Strong. A noise burst trapped in a damped delay loop; the most
// organic thing in the library, because the timbre is a real physical decay
// rather than an envelope.
// ————————————————————————————————————————————————————————————
export function voicePluck(eng, p) {
  const ctx = eng.ctx;
  const t = ctx.currentTime + 0.002;
  const { amp, shape } = p;
  const chain = eng.chain(p.pan, p.depth, amp);

  // A feedback loop needs at least one render block of delay, so fold the pitch
  // down until the loop is long enough to be legal. A pluck an octave or two low
  // is fine; a silently mistuned loop is not.
  let hz = p.hz;
  const minHz = ctx.sampleRate / 128;
  let guard = 0;
  while (hz > minHz && guard++ < 8) hz /= 2;
  const period = 1 / hz;

  const dl = ctx.createDelay(0.06);
  dl.delayTime.value = period;

  // Damping is a 2-tap FIR average — y = a·x[n] + (1-a)·x[n-1] — which is what
  // Karplus-Strong actually specifies. A BiquadFilter here diverges: measured,
  // the same loop with a biquad in it reached 1e13 while the master compressor
  // hid the fault by clamping the output to 0.9, so `amp` stopped doing anything
  // at all. An FIR cannot add gain, so the loop stays bounded by feedback alone.
  const one = ctx.createDelay(0.01);
  one.delayTime.value = 1 / ctx.sampleRate;
  // spike keeps the string bright, skew dulls it
  const a = clamp(lerp(0.5, 0.9, shape.spike) * lerp(1, 0.8, shape.skew), 0.35, 0.95);
  const gA = ctx.createGain();
  gA.gain.value = a;
  const gB = ctx.createGain();
  gB.gain.value = 1 - a;
  const sum = ctx.createGain();
  sum.gain.value = 1;
  dl.connect(gA);
  gA.connect(sum);
  dl.connect(one);
  one.connect(gB);
  gB.connect(sum);

  const dec = p.decay * lerp(0.55, 1.7, shape.size);
  const fb = ctx.createGain();
  const fbAmount = clamp(Math.pow(0.001, period / Math.max(0.12, dec)), 0.2, 0.995);
  fb.gain.setValueAtTime(fbAmount, t);
  // kill the loop when the note is over, so it does not ring on forever
  fb.gain.setValueAtTime(0, t + dec + 0.08);
  sum.connect(fb);
  fb.connect(dl);

  // tone shaping stays OUTSIDE the loop, where a biquad is safe
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = clamp(hz * lerp(11, 40, shape.spike), 900, 15000);
  tone.Q.value = 0.6;
  sum.connect(tone);
  tone.connect(chain.pn);

  // excite with a burst about one loop period long
  const src = ctx.createBufferSource();
  src.buffer = eng.noise;
  const ex = ctx.createGain();
  ex.gain.setValueAtTime(1, t);
  ex.gain.exponentialRampToValueAtTime(0.0001, t + period * (1.2 + shape.skew * 1.6));
  src.connect(ex);
  ex.connect(dl);
  src.start(t);
  src.stop(t + 0.12);

  return finish(eng, chain, [{ period: dl.delayTime, base: period }], dec + 0.12, amp, hz);
}

// ————————————————————————————————————————————————————————————
// skin — a soft membrane. Hand on a drum head: pitched noise through a moderate
// bandpass over a falling tone. No stick, no click.
// ————————————————————————————————————————————————————————————
export function voiceSkin(eng, p) {
  const ctx = eng.ctx;
  const t = ctx.currentTime + 0.002;
  const { hz, amp, shape } = p;
  const chain = eng.chain(p.pan, p.depth, amp);
  const dec = p.decay * lerp(0.5, 1.4, shape.size);
  const items = [];

  // the head: noise through a bandpass that opens with spike
  const src = ctx.createBufferSource();
  src.buffer = eng.noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = clamp(hz * lerp(1.1, 3.4, shape.spike), 60, 6000);
  bp.Q.value = lerp(5, 1.4, shape.skew);
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.0001, t);
  hg.gain.linearRampToValueAtTime(0.55 * lerp(0.7, 1.3, shape.skew), t + 0.006);
  hg.gain.exponentialRampToValueAtTime(0.0001, t + dec * 0.45);
  src.connect(bp);
  bp.connect(hg);
  hg.connect(chain.pn);
  src.start(t);
  items.push({ freq: bp.frequency, base: bp.frequency.value });

  // the body tone, falling in like a struck head does
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(clamp(hz * lerp(1.3, 2.1, shape.size), 20, 9000), t);
  o.frequency.exponentialRampToValueAtTime(hz, t + 0.05 + shape.size * 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.75, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  o.connect(g);
  g.connect(chain.pn);
  o.start(t);
  o.stop(t + dec + 0.05);
  items.push({ detune: o.detune });

  return finish(eng, chain, items, dec + 0.06, amp, hz);
}

// ————————————————————————————————————————————————————————————
// bowl — a singing bowl. Inharmonic partials, very soft attack, long decay, and
// detuned pairs so it beats against itself.
// ————————————————————————————————————————————————————————————
export function voiceBowl(eng, p) {
  const ctx = eng.ctx;
  const t = ctx.currentTime + 0.002;
  const { hz, amp, shape } = p;
  const chain = eng.chain(p.pan, p.depth, amp);
  const dec = p.decay * lerp(1.2, 3.2, shape.size);
  const atk = 0.03 + shape.size * 0.06;
  const items = [];
  let life = 0;

  // ratios of a struck bowl, pushed further off true by skew
  const RATIOS = [1, 2.32, 3.51, 5.07];
  RATIOS.forEach((r, i) => {
    const ratio = r * (1 + shape.skew * 0.09 * (i % 2 ? 1 : -1));
    const level = (i === 0 ? 0.7 : 0.34 / i) * lerp(1, 1 + shape.spike, i / 3);
    const life_i = dec / (1 + i * 0.5);
    for (let d = 0; d < 2; d++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      // the beating: a few cents apart, widened by skew
      o.detune.value = (d ? 1 : -1) * (2.5 + shape.skew * 9);
      o.frequency.value = clamp(hz * ratio, 20, 17000);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level * 0.5, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + life_i);
      o.connect(g);
      g.connect(chain.pn);
      o.start(t);
      o.stop(t + life_i + 0.05);
      items.push({ detune: o.detune });
      life = Math.max(life, life_i);
    }
  });

  return finish(eng, chain, items, life + 0.06, amp, hz);
}

// ————————————————————————————————————————————————————————————
// drop — water. A tiny sine bending UPWARD, which is the whole trick: every
// other voice falls, so this one reads instantly as something else.
// ————————————————————————————————————————————————————————————
export function voiceDrop(eng, p) {
  const ctx = eng.ctx;
  const t = ctx.currentTime + 0.002;
  const { hz, amp, shape } = p;
  const chain = eng.chain(p.pan, p.depth, amp);
  const dec = p.decay * lerp(0.5, 1.3, shape.size);
  const rise = 0.03 + shape.size * 0.05;
  const items = [];

  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(clamp(hz * lerp(0.42, 0.72, shape.skew), 20, 9000), t);
  o.frequency.exponentialRampToValueAtTime(clamp(hz * lerp(1, 1.5, shape.spike), 20, 12000), t + rise);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.85, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  o.connect(g);
  g.connect(chain.pn);
  o.start(t);
  o.stop(t + dec + 0.04);
  items.push({ detune: o.detune });

  // the surface: a very short high plink over the top
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = clamp(hz * lerp(4, 9, shape.spike), 40, 15000);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.22, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o2.connect(g2);
  g2.connect(chain.pn);
  o2.start(t);
  o2.stop(t + 0.08);
  items.push({ detune: o2.detune });

  return finish(eng, chain, items, dec + 0.05, amp, hz);
}

// ————————————————————————————————————————————————————————————
// air — blown. Resonant noise at pitch with a quiet sine core and a soft
// attack: breath rather than a strike.
// ————————————————————————————————————————————————————————————
export function voiceAir(eng, p) {
  const ctx = eng.ctx;
  const t = ctx.currentTime + 0.002;
  const { hz, amp, shape } = p;
  const chain = eng.chain(p.pan, p.depth, amp);
  const dec = p.decay * lerp(0.8, 2.0, shape.size);
  const atk = 0.04 + shape.size * 0.09;
  const items = [];

  const src = ctx.createBufferSource();
  src.buffer = eng.breath;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = clamp(hz * lerp(1, 2.6, shape.spike), 60, 8000);
  // skew makes it breathier, spike makes it whistle
  bp.Q.value = lerp(16, 3.5, shape.skew);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.linearRampToValueAtTime(0.7, t + atk);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  src.connect(bp);
  bp.connect(bg);
  bg.connect(chain.pn);
  src.start(t);
  src.stop(t + dec + 0.06);
  items.push({ freq: bp.frequency, base: bp.frequency.value });

  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = clamp(hz, 20, 9000);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.3 * (1 - shape.skew * 0.5), t + atk * 1.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  o.connect(g);
  g.connect(chain.pn);
  o.start(t);
  o.stop(t + dec + 0.06);
  items.push({ detune: o.detune });

  return finish(eng, chain, items, dec + 0.06, amp, hz);
}

export const FAMILIES = {
  bar: voiceBar,
  pluck: voicePluck,
  skin: voiceSkin,
  bowl: voiceBowl,
  drop: voiceDrop,
  air: voiceAir,
};
