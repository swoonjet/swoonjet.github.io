/* ============================================================
   CHORD LOOM — the room, slice 2 (FX — SHARED AIR)
   Port of \loomRoom from 14b-chord-loom.scd. Signal path, same
   order as SC:
     pads → PING-PONG TAPE ECHO (cross-fed feedback, tanh+LPF in
     the loop; echoTime moves glide the pitch like real tape)
     → +SHIMMER (octave-up phase-vocoder send, into the verb only)
     → humid verb (convolver, generated IR; darkness = wet lowpass)
     → mid/side WIDTH → master → limiter.
   All six pad orbits (and the ping orbit) are rerouted out of
   superdough's own output into room.input, so the per-pad memory
   loops ride along and the whole loom breathes one air.
   ============================================================ */

const LAG = (s) => Math.max(s / 3.5, 0.02);   // SC .lag() → setTargetAtTime τ

// generated impulse response — exponential-decay noise, ~RT60 4s,
// stereo-decorrelated. Stands in for FreeVerb2 room 0.94.
function makeIR(ctx, seconds = 4.5, tau = 0.7) {
  const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let energy = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t / tau);
      energy += d[i] * d[i];
    }
    // normalize power so sustained input comes back at ~unity
    const k = 1 / Math.sqrt(energy);
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  return buf;
}

// tanh with UNITY slope at zero (SC .tanh): WaveShaper clamps input to
// ±1, so we pre-scale by 1/4 and sample tanh over ±4 — small-signal
// gain is exactly 1, saturation ceiling ±1. Slope >1 here would make
// the echo loop self-oscillate at feedback ≥ 1/slope.
const TANH_DOMAIN = 4;
function tanhCurve(n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * TANH_DOMAIN);
  return c;
}

// ── per-pad MEMORY loop — SC's in-synth tape loop, one per pad:
//    loop = DelayC(LeakDC(LPF(sig + fb·fbAmt)).tanh, ltime); sig += loop·0.55
//    Owned here (not superdough's orbit delay) so delay-time wobble can
//    RAMP — superdough sets delayTime with setValueAtTime, and instant
//    delay jumps on live audio are clicks. ──
export function createPadMemory(ctx) {
  const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const input = g(1), out = g(1), fbSum = g(1), fbGain = g(0.45), wet = g(0.55);
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 1900;
  const dc = ctx.createBiquadFilter();
  dc.type = 'highpass'; dc.frequency.value = 8;
  const pre = g(1 / TANH_DOMAIN);
  const shaper = ctx.createWaveShaper();
  shaper.curve = tanhCurve();
  const delay = ctx.createDelay(1.6);
  delay.delayTime.value = 0.6;
  input.connect(out);                 // dry through
  input.connect(fbSum);
  fbSum.connect(lpf); lpf.connect(dc); dc.connect(pre); pre.connect(shaper); shaper.connect(delay);
  delay.connect(wet); wet.connect(out);
  delay.connect(fbGain); fbGain.connect(fbSum);
  return {
    input, out,
    set(fbAmt, time, timeTc = 1.2) {
      const t = ctx.currentTime;
      fbGain.gain.setTargetAtTime(Math.min(Math.max(fbAmt, 0), 0.9), t, 0.4);
      delay.delayTime.setTargetAtTime(Math.min(Math.max(time, 0.05), 1.5), t, timeTc);
    },
  };
}

export function createRoom(ctx) {
  const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };

  const input = g(1);            // orbits connect here
  const sigSum = g(1);           // dry + echo — the "sig" of the SC room
  input.connect(sigSum);

  // ── ping-pong tape echo ──
  const split = ctx.createChannelSplitter(2);
  input.connect(split);
  const merge = ctx.createChannelMerger(2);
  const chans = [0, 1].map((ch) => {
    const loopIn = g(1);
    split.connect(loopIn, ch);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 3500;
    const dc = ctx.createBiquadFilter();
    dc.type = 'highpass'; dc.frequency.value = 8;      // LeakDC
    // pre-scale into the ±4 curve domain; the curve itself re-expands
    // (tanh(4 · x/4) = tanh(x)), so no post-gain — slope 1, ceiling ±1
    const pre = g(1 / TANH_DOMAIN);
    const shaper = ctx.createWaveShaper();
    shaper.curve = tanhCurve();
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.45;
    loopIn.connect(lpf); lpf.connect(dc); dc.connect(pre);
    pre.connect(shaper); shaper.connect(delay);
    delay.connect(merge, 0, ch);
    return { loopIn, delay, fb: g(0.35) };
  });
  // .reverse in SC = cross-feed: L's delay returns into R's input and vice versa
  chans[0].delay.connect(chans[1].fb); chans[1].fb.connect(chans[0].loopIn);
  chans[1].delay.connect(chans[0].fb); chans[0].fb.connect(chans[1].loopIn);
  const echoMix = g(0);
  merge.connect(echoMix);
  echoMix.connect(sigSum);

  // ── shimmer — octave-up send, feeds the verb only (like SC) ──
  let shimGain = null;
  try {
    const pv = new AudioWorkletNode(ctx, 'phase-vocoder-processor',
      { outputChannelCount: [2] });
    pv.parameters.get('pitchFactor').value = 2.0;
    shimGain = g(0);
    sigSum.connect(pv);
    pv.connect(shimGain);
  } catch (e) {
    console.warn('[room] phase vocoder unavailable — shimmer disabled', e);
  }

  // ── humid verb ── out = sig·(1−humidity) + verb(sig+shim)·humidity
  const verbIn = g(1);
  sigSum.connect(verbIn);
  if (shimGain) shimGain.connect(verbIn);
  const conv = ctx.createConvolver();
  conv.buffer = makeIR(ctx);
  const darknessLpf = ctx.createBiquadFilter();
  darknessLpf.type = 'lowpass'; darknessLpf.frequency.value = 1200 + (1 - 0.6) * 6800;
  const wet = g(0.55), dry = g(0.45);
  verbIn.connect(conv); conv.connect(darknessLpf); darknessLpf.connect(wet);
  sigSum.connect(dry);
  const roomOut = g(1);
  wet.connect(roomOut); dry.connect(roomOut);

  // ── mid/side width ──
  const wSplit = ctx.createChannelSplitter(2);
  roomOut.connect(wSplit);
  const mid = g(0.5), sideRaw = g(0.5), sideInvIn = g(-1);
  wSplit.connect(mid, 0); wSplit.connect(mid, 1);          // (L+R)/2
  wSplit.connect(sideRaw, 0); wSplit.connect(sideInvIn, 1); // (L−R)/2
  sideInvIn.connect(sideRaw);
  const side = g(1.2);                                      // width gain
  sideRaw.connect(side);
  const sideNeg = g(-1);
  side.connect(sideNeg);
  const wMerge = ctx.createChannelMerger(2);
  mid.connect(wMerge, 0, 0); side.connect(wMerge, 0, 0);    // L = mid + side
  mid.connect(wMerge, 0, 1); sideNeg.connect(wMerge, 0, 1); // R = mid − side

  // ── master + limiter ──
  const master = g(1);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20;
  lim.attack.value = 0.003; lim.release.value = 0.25;
  wMerge.connect(master); master.connect(lim); lim.connect(ctx.destination);

  // ── param surface — SC names, SC lags ──
  const state = { echoTime: 0.45, echoFb: 0.35, echoMix: 0, shimmer: 0,
    humidity: 0.55, darkness: 0.6, width: 1.2, vol: 1 };
  const setters = {
    echoTime: (v) => chans.forEach(c =>
      c.delay.delayTime.setTargetAtTime(Math.min(Math.max(v, 0.05), 1.4), ctx.currentTime, LAG(3))),
    echoFb:   (v) => chans.forEach(c => c.fb.gain.setTargetAtTime(v, ctx.currentTime, LAG(0.3))),
    echoMix:  (v) => echoMix.gain.setTargetAtTime(v, ctx.currentTime, LAG(2)),
    shimmer:  (v) => shimGain && shimGain.gain.setTargetAtTime(v, ctx.currentTime, LAG(4)),
    humidity: (v) => { wet.gain.setTargetAtTime(v, ctx.currentTime, LAG(4));
                       dry.gain.setTargetAtTime(1 - v, ctx.currentTime, LAG(4)); },
    darkness: (v) => darknessLpf.frequency.setTargetAtTime(1200 + (1 - v) * 6800, ctx.currentTime, LAG(4)),
    width:    (v) => side.gain.setTargetAtTime(v, ctx.currentTime, LAG(3)),
    vol:      (v) => master.gain.setTargetAtTime(v, ctx.currentTime, LAG(2)),
  };
  return {
    input,
    state,
    set(key, v) { state[key] = v; setters[key]?.(v); },
    hasShimmer: !!shimGain,
    _master: master,   // test hook
    _limiter: lim,     // record tap — post-everything, what the ears get
  };
}
