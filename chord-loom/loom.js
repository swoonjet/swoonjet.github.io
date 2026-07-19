/* ============================================================
   CHORD LOOM — web port, slice 1 (first sound)
   Source of truth: supercollider-lab/lessons/14b-chord-loom.scd
   Sound engine: superdough (vendored, see vendor/) — the loom's
   held pads are rebuilt as overlapping retriggered events on one
   superdough orbit per pad; the orbit's output gain is our LagUD
   handle, so rise/fall blooms stay real-time even though voice
   parameters only update per cycle (~3s — inside the loom's own
   modulation rates).
   ============================================================ */

import {
  superdough, initAudio, registerSynthSounds,
  getSuperdoughAudioController, getAudioContext, getSound,
} from './vendor/superdough.mjs';
import { createRoom, createPadMemory } from './room.js';

// ── loom constants (from the SC build; slots doubled 2026-07-19) ──
const N_SLOTS = 12, MAX_NOTES = 8;
const KB_LO = 36, KB_HI = 72;                       // C2..C5
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const OSC_NAMES = ['saw choir', 'glass', 'soft FM', 'breath', 'organ',
  'far choir', 'tape strings', 'reed', 'undertow', 'weave'];
// muted natural-dye tones: pine, moss, persimmon, indigo, plum, kaki,
// then tetsu, karashi, nibi, azuki, matcha, fuji for the second row
const PAD_COLORS = ['#44523f', '#5c5a38', '#8a5433', '#3d5260', '#4b4159', '#6d4548',
  '#3a4f4d', '#71603a', '#565e68', '#6b4a41', '#506047', '#5e4a63'];
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const SEL_COL = '#c96f43';

// per-pad defaults — same numbers as ~params in 14b. Mutable: ALL-mode
// inspector edits change these, and new pads inherit them (SC behavior).
const DEFAULTS = {
  amp: 0.5, fbAmt: 0.45, warp: 0.01, detune: 12, sub: 0.15,
  cutoff: 1600, rq: 0.5, wDepth: 0.35, wRate: 0.06, bDepth: 0.5, bRate: 0.1,
  drift: 0.25, rise: 12, fall: 18,
};

// inspector sliders — labels, groups, and ControlSpecs verbatim from 14b.
// `focus` runs hi→lo on purpose (right = tighter resonance = lower rq).
const PAD_SPECS = [
  { group: 'ENVELOPE',     key: 'rise',   label: 'rise (in)',     lo: 0.5,  hi: 60,   curve: 'exp' },
  { group: 'ENVELOPE',     key: 'fall',   label: 'fall (out)',    lo: 0.5,  hi: 90,   curve: 'exp' },
  { group: 'ENGINE',       key: 'amp',    label: 'loudness',      lo: 0,    hi: 1,    curve: 'lin' },
  { group: 'ENGINE',       key: 'fbAmt',  label: 'memory (fb)',   lo: 0,    hi: 0.85, curve: 'lin' },
  { group: 'ENGINE',       key: 'warp',   label: 'warp (loop)',   lo: 0,    hi: 0.08, curve: 'lin' },
  { group: 'ENGINE',       key: 'detune', label: 'detune (¢)',    lo: 0,    hi: 35,   curve: 'lin' },
  { group: 'ENGINE',       key: 'sub',    label: 'sub',           lo: 0,    hi: 0.4,  curve: 'lin' },
  { group: 'FILTER + LFO', key: 'cutoff', label: 'cutoff',        lo: 150,  hi: 9000, curve: 'exp' },
  { group: 'FILTER + LFO', key: 'rq',     label: 'focus (res)',   lo: 1.0,  hi: 0.1,  curve: 'exp' },
  { group: 'FILTER + LFO', key: 'wDepth', label: 'weather',       lo: 0,    hi: 1,    curve: 'lin' },
  { group: 'FILTER + LFO', key: 'wRate',  label: 'weather rate',  lo: 0.01, hi: 0.3,  curve: 'exp' },
  { group: 'FILTER + LFO', key: 'bDepth', label: 'breathe',       lo: 0,    hi: 1,    curve: 'lin' },
  { group: 'FILTER + LFO', key: 'bRate',  label: 'breathe rate',  lo: 0.02, hi: 0.6,  curve: 'exp' },
  { group: 'FILTER + LFO', key: 'drift',  label: 'drift (pitch)', lo: 0,    hi: 1,    curve: 'lin' },
];

// slider-position ↔ value mapping (works for reversed exp specs too)
function specMap(spec) {
  const map = x => spec.curve === 'exp'
    ? spec.lo * Math.pow(spec.hi / spec.lo, x)
    : spec.lo + (spec.hi - spec.lo) * x;
  const unmap = v => spec.curve === 'exp'
    ? Math.log(v / spec.lo) / Math.log(spec.hi / spec.lo)
    : (v - spec.lo) / (spec.hi - spec.lo);
  return { map, unmap };
}

// retrigger geometry: DUR overlaps two cycles; linear ADSR crossfade
// keeps the sum near-constant while each cycle resamples the LFO walks
const CYCLE = 3.0, DUR = CYCLE * 2 + 0.25, ATK = CYCLE * 0.9, REL = CYCLE * 1.05;
const ORBIT_BASE = 11;                              // pads live on orbits 11..16

const midicps = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const noteStr = m => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

// ── chord namer — direct port of the SC logic (bass-first root
//    search so A-C-E-G reads Am7, slash names for inversions) ──
const QUALS = [
  [[0, 4, 7], ''], [[0, 3, 7], 'm'], [[0, 3, 6], 'dim'], [[0, 4, 8], 'aug'],
  [[0, 5, 7], 'sus4'], [[0, 2, 7], 'sus2'], [[0, 7], '5'],
  [[0, 4, 7, 10], '7'], [[0, 4, 7, 11], 'maj7'], [[0, 3, 7, 10], 'm7'],
  [[0, 3, 7, 11], 'mMaj7'], [[0, 3, 6, 10], 'm7b5'], [[0, 3, 6, 9], 'dim7'],
  [[0, 4, 7, 9], '6'], [[0, 3, 7, 9], 'm6'], [[0, 5, 7, 10], '7sus4'],
  [[0, 2, 4, 7], 'add9'], [[0, 2, 3, 7], 'madd9'],
  [[0, 2, 4, 7, 10], '9'], [[0, 2, 3, 7, 10], 'm9'], [[0, 2, 4, 7, 11], 'maj9'],
];
function chordName(notes) {
  const pcs = [...new Set(notes.map(m => m % 12))].sort((a, b) => a - b);
  const bassPc = Math.min(...notes) % 12;
  const roots = [bassPc, ...pcs.filter(p => p !== bassPc)];
  let found = null;
  for (const root of roots) {
    if (found) break;
    const iv = pcs.map(p => ((p - root) % 12 + 12) % 12).sort((a, b) => a - b);
    for (const [q, name] of QUALS) {
      if (!found && iv.length === q.length && iv.every((x, k) => x === q[k])) found = [root, name];
    }
  }
  if (found) {
    return NOTE_NAMES[found[0]] + found[1] + (bassPc !== found[0] ? '/' + NOTE_NAMES[bassPc] : '');
  }
  return notes.map(m => NOTE_NAMES[m % 12]).join(' ');
}

// ── audio bring-up ──
let audioUp = false, audioPromise = null, room = null;
const padMemories = Array(N_SLOTS).fill(null);
function ensureAudio() {
  if (!audioPromise) {
    audioPromise = (async () => {
      // 12 pads × 8 notes × layered events can pass the default 128-voice
      // cap when the whole loom sounds at once — give it headroom
      await initAudio({ maxPolyphony: 512 });
      registerSynthSounds();
      // the shared air: build the room, then pull every loom orbit out
      // of superdough's own output and into it (pad memory loops ride
      // along — the orbit's delay feeds its output)
      room = createRoom(getAudioContext());
      const ctrl = getSuperdoughAudioController();
      const orbits = [2, ...Array.from({ length: N_SLOTS }, (_, i) => ORBIT_BASE + i)];
      for (const n of orbits) {
        let orb;
        try { orb = ctrl.getOrbit(n, [1, 2]); } catch { orb = ctrl.getOrbit(n); }
        orb.output.disconnect();
        if (n === 2) {
          orb.output.connect(room.input);          // pings go straight to the air
        } else {
          // pad orbits pass through their own memory loop first,
          // and start silent so loaded/restored pads bloom via LagUD
          const mem = createPadMemory(getAudioContext());
          padMemories[n - ORBIT_BASE] = mem;
          orb.output.connect(mem.input);
          mem.out.connect(room.input);
          orb.output.gain.value = 0.0001;
        }
      }
      for (const [k, v] of Object.entries(fxState)) room.set(k, v);
      audioUp = true;
    })();
  }
  return audioPromise;
}
// breath voice needs a noise source; find whichever superdough registered
function noiseName() {
  return ['pink', 'white', 'brown'].find(s => { try { return !!getSound(s); } catch { return false; } });
}
const now = () => getAudioContext().currentTime;

// ── state ──
const selection = new Set();
const bank = Array(N_SLOTS).fill(null);   // {name, notes, osc, params, loopTime, walks…}
const active = Array(N_SLOTS).fill(false);
const livePads = new Set();               // every pad still weaving, incl. deleted tails

// slow random walks — the JS stand-in for LFNoise2, sampled once per cycle
function stepWalk(pad) {
  const p = pad.params;
  const w = pad.walks;
  const step = (v, rate, lo, hi) => clamp(v + (Math.random() * 2 - 1) * rate * CYCLE * 2.2, lo, hi);
  w.weather = step(w.weather, p.wRate, -1, 1);
  w.warp = step(w.warp, 0.3, -1, 1);
  w.fm = step(w.fm, 0.08, 0.2, 1.5);
  pad.notes.forEach((_, k) => { w.breathe[k] = step(w.breathe[k] ?? Math.random(), p.bRate, 0, 1); });
}

function orbitOut(i) {
  try { return getSuperdoughAudioController().getOrbit(ORBIT_BASE + i)?.output; }
  catch { return null; }
}

// LagUD — independent rise/fall time constants on the pad's orbit gain
function setPadLevel(pad, level) {
  const out = orbitOut(pad.slot);
  if (!out) return;
  const tau = (level > 0.5 ? pad.params.rise : pad.params.fall) / 3.5;
  out.gain.setTargetAtTime(level, now(), Math.max(tau, 0.02));
}

// fire one retrigger cycle for a pad at absolute time t
function fireCycle(pad, t) {
  stepWalk(pad);
  const p = pad.params, w = pad.walks, n = pad.notes.length;
  const orbit = ORBIT_BASE + pad.slot;
  const cutoff = clamp(p.cutoff * Math.pow(2, w.weather * p.wDepth * 2), 80, 12000);
  const base = {
    orbit, cutoff, resonance: clamp(1 / Math.max(p.rq, 0.1) - 1, 0, 10),
    attack: ATK, decay: 0.1, sustain: 0.92, release: REL,
  };
  // memory loop lives outside superdough (see createPadMemory) — feed it
  // this cycle's smoothly-ramped wobble instead of per-event delay params
  padMemories[pad.slot]?.set(p.fbAmt, pad.loopTime * (1 + w.warp * p.warp), 1.2);
  const gNorm = p.amp * 0.9 / Math.sqrt(n);
  const dtr = p.detune / 100 / 2;              // cents → ± half, in semitones
  const rHi = Math.pow(2, dtr / 12), rLo = 1 / rHi;
  const vib = { vib: 0.05, vibmod: p.drift * 0.18 };
  // ±0.4-cent per-event humanization — inaudible as pitch, but keeps
  // retriggered same-frequency sines from phase-cancelling against the
  // overlapping previous cycle (measured as cycle-locked breathing)
  const hz = (f) => f * (1 + (Math.random() - 0.5) * 0.0005);

  pad.notes.forEach((m, k) => {
    const f = midicps(m);
    const g = gNorm * (1 - p.bDepth * (pad.walks.breathe[k] ?? 0.5) * 0.85);
    const pan = n === 1 ? 0.5 : 0.5 + 0.375 * ((k / (n - 1)) * 2 - 1);   // Splay .75
    const ev = (v, d = DUR) => superdough(v, t, d).catch(() => {});
    switch (pad.osc) {
      case 0: // saw choir — supersaw worklet carries the detuned unison
        ev({ ...base, ...vib, s: 'supersaw', freq: f, unison: 3,
          detune: Math.max(p.detune / 100, 0.01), spread: 0.45, gain: g * 0.42, pan });
        break;
      case 1: // glass — detuned sine pair + soft partials at 2.002/3.004
        ev({ ...base, ...vib, s: 'sine', freq: hz(f * rLo), gain: g * 0.30, pan });
        ev({ ...base, ...vib, s: 'sine', freq: hz(f * rHi), gain: g * 0.30, pan: 1 - pan });
        ev({ ...base, s: 'sine', freq: hz(f * 2.002), gain: g * 0.09, pan });
        ev({ ...base, s: 'sine', freq: hz(f * 3.004), gain: g * 0.035, pan });
        break;
      case 2: // soft FM — index wanders 0.2..1.5 like the LFNoise2 original
        ev({ ...base, ...vib, s: 'sine', freq: hz(f), fm: w.fm, fmh: 2.01, gain: g * 0.5, pan });
        break;
      case 3: { // breath — resonant noise at f and 2.4f
        const ns = noiseName();
        if (ns) {
          ev({ ...base, s: ns, bandf: f, bandq: 28, gain: g * 0.6, pan });
          ev({ ...base, s: ns, bandf: f * 2.4, bandq: 14, gain: g * 0.28, pan: 1 - pan });
        } else { // no noise sound registered — hushed sine stand-in
          ev({ ...base, ...vib, s: 'sine', freq: f, gain: g * 0.3, pan });
        }
        break;
      }
      case 4: // organ — pulse worklet pair + octave partial
        ev({ ...base, ...vib, s: 'pulse', freq: f * rLo, pw: 0.48, gain: g * 0.2, pan });
        ev({ ...base, ...vib, s: 'pulse', freq: f * rHi, pw: 0.48, gain: g * 0.2, pan: 1 - pan });
        ev({ ...base, s: 'pulse', freq: hz(f * 2.002), pw: 0.44, gain: g * 0.09, pan });
        break;
      case 5: // far choir — detuned saws through the vowel filter, one
              // mouth per note so chords read as different singers
        ev({ ...base, ...vib, s: 'sawtooth', freq: f * rLo, vowel: ['o', 'a', 'e'][k % 3], gain: g * 0.38, pan });
        ev({ ...base, ...vib, s: 'sawtooth', freq: f * rHi, vowel: ['a', 'o', 'o'][k % 3], gain: g * 0.28, pan: 1 - pan });
        break;
      case 6: // tape strings — wide worn unison, darker filter, tape wobble
        ev({ ...base, cutoff: Math.max(base.cutoff * 0.6, 200),
          s: 'supersaw', freq: f, unison: 6,
          detune: Math.max(p.detune / 100 * 1.6, 0.05), spread: 0.7,
          vib: 0.11, vibmod: p.drift * 0.3 + 0.05, gain: g * 0.36, pan });
        break;
      case 7: // reed — hollow square with a tighter focus, sine core
        ev({ ...base, resonance: Math.min(base.resonance + 3, 12),
          ...vib, s: 'square', freq: f, gain: g * 0.22, pan });
        ev({ ...base, s: 'square', freq: hz(f * 2.004), gain: g * 0.05, pan: 1 - pan });
        ev({ ...base, s: 'sine', freq: hz(f), gain: g * 0.18, pan });
        break;
      case 8: // undertow — half-speed FM wobble under a sub octave; the
              // fmh 0.5 modulator puts sidebands BELOW the note
        ev({ ...base, s: 'sine', freq: hz(f), fm: 0.35 + w.fm * 0.45, fmh: 0.5, gain: g * 0.45, pan });
        ev({ ...base, s: 'sine', freq: hz(f / 2), gain: g * 0.26, pan: 0.5 });
        ev({ ...base, ...vib, s: 'triangle', freq: hz(f), gain: g * 0.11, pan: 1 - pan });
        break;
      case 9: // weave — thin/wide pulse pair drifting through a slow phaser
        ev({ ...base, ...vib, s: 'pulse', freq: f * rLo, pw: 0.30, gain: g * 0.2, pan,
          phaser: 0.05 + w.fm * 0.04, phaserdepth: 0.6 });
        ev({ ...base, ...vib, s: 'pulse', freq: f * rHi, pw: 0.62, gain: g * 0.2, pan: 1 - pan,
          phaser: 0.04 + w.fm * 0.03, phaserdepth: 0.5 });
        break;
    }
  });
  // sub — sine an octave under the lowest note (slot 0 in SC)
  if (p.sub > 0.005) {
    superdough({ ...base, s: 'sine', freq: midicps(Math.min(...pad.notes)) / 2 * (1 + (Math.random() - 0.5) * 0.0005),
      gain: p.sub * 0.9, pan: 0.5 }, t, DUR).catch(() => {});
  }
}

// scheduler — one lookahead loop drives every weaving pad (incl. tails)
setInterval(() => {
  if (!audioUp) return;
  const tNow = now();
  for (const pad of livePads) {
    if (pad.stopAfter && tNow > pad.stopAfter) { livePads.delete(pad); continue; }
    if (pad.nextAt < tNow - 0.1) pad.nextAt = tNow + 0.05;   // catch up after tab sleep
    while (pad.nextAt < tNow + 0.6) { fireCycle(pad, pad.nextAt); pad.nextAt += CYCLE; }
  }
}, 200);

// keyboard preview ping — sine + whisper of triangle an octave up
function ping(m, amp = 0.13) {
  const f = midicps(m);
  superdough({ s: 'sine', freq: f, gain: amp, attack: 0.004, decay: 1.15,
    sustain: 0, release: 0.05, cutoff: f * 4, orbit: 2 }, now() + 0.02, 1.25).catch(() => {});
  superdough({ s: 'triangle', freq: f * 2.001, gain: amp * 0.17, attack: 0.004,
    decay: 1.0, sustain: 0, release: 0.05, cutoff: f * 4, orbit: 2 }, now() + 0.02, 1.1).catch(() => {});
}

// ── UI ──
const kb = document.getElementById('kb');
const readout = document.getElementById('readout');
const status = document.getElementById('status');
const slotsEl = document.getElementById('slots');
const whites = [];
for (let m = KB_LO; m <= KB_HI; m++) if (WHITE_PCS.includes(m % 12)) whites.push(m);

function drawKb() {
  const ctx = kb.getContext('2d');
  const W = kb.width = kb.clientWidth * devicePixelRatio;
  const H = kb.height = kb.clientHeight * devicePixelRatio;
  const w = W / whites.length, bh = H * 0.62, bw = w * 0.62;
  whites.forEach((m, wi) => {
    ctx.fillStyle = selection.has(m) ? SEL_COL : '#e9e1cf';   // ivory
    ctx.fillRect(wi * w, 0, w - devicePixelRatio, H);
    if (m % 12 === 0) {
      ctx.fillStyle = 'rgba(42,33,24,0.5)';
      ctx.font = `300 ${9 * devicePixelRatio}px "Hiragino Sans", "Helvetica Neue", sans-serif`;
      ctx.fillText('C' + (Math.floor(m / 12) - 1), wi * w + 5 * devicePixelRatio, H - 8 * devicePixelRatio);
    }
  });
  for (let m = KB_LO; m <= KB_HI; m++) {
    if (WHITE_PCS.includes(m % 12)) continue;
    const wi = whites.indexOf(m - 1);
    const bx = (wi + 1) * w - bw / 2;
    ctx.fillStyle = selection.has(m) ? SEL_COL : '#241d16';   // lacquer
    ctx.fillRect(bx, 0, bw, bh);
  }
}

function hitTest(x, y) {
  const r = kb.getBoundingClientRect();
  const w = r.width / whites.length, bh = r.height * 0.62, bw = w * 0.62;
  if (y < bh) {
    for (let m = KB_LO; m <= KB_HI; m++) {
      if (WHITE_PCS.includes(m % 12)) continue;
      const wi = whites.indexOf(m - 1);
      const bx = (wi + 1) * w - bw / 2;
      if (x >= bx && x <= bx + bw) return m;
    }
  }
  return whites[clamp(Math.floor(x / w), 0, whites.length - 1)];
}

function updateReadout() {
  const arr = [...selection].sort((a, b) => a - b);
  readout.textContent = arr.length
    ? arr.map(noteStr).join('  ') + '      =  ' + chordName(arr)
    : '· click keys to build a chord ·';
  drawKb();
}

async function toggleNote(m) {
  await ensureAudio();
  if (selection.has(m)) selection.delete(m);
  else if (selection.size < MAX_NOTES) { selection.add(m); ping(m, 0.14); }
  else status.textContent = '8 notes max per chord — remove one first';
  updateReadout();
}

kb.addEventListener('mousedown', e => {
  const r = kb.getBoundingClientRect();
  toggleNote(hitTest(e.clientX - r.left, e.clientY - r.top));
});
window.addEventListener('resize', drawKb);

// pad slots
const padBtns = [], oscSels = [];
for (let i = 0; i < N_SLOTS; i++) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  const padBtn = document.createElement('button');
  padBtn.className = 'pad-btn';
  padBtn.textContent = '· empty ·';
  padBtn.addEventListener('click', () => togglePad(i));
  const row = document.createElement('div');
  row.className = 'row2';
  const loadBtn = document.createElement('button');
  loadBtn.className = 'load';
  loadBtn.textContent = 'LOAD';
  loadBtn.addEventListener('click', () => loadPad(i));
  const delBtn = document.createElement('button');
  delBtn.className = 'del';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => deletePad(i));
  row.append(loadBtn, delBtn);
  const sel = document.createElement('select');
  OSC_NAMES.forEach((n, k) => sel.add(new Option(n, k)));
  sel.addEventListener('change', () => {
    if (bank[i]) {
      bank[i].osc = +sel.value;
      status.textContent = `pad ${i + 1} voice → ${OSC_NAMES[+sel.value]}`;
    }
  });
  slot.append(padBtn, row, sel);
  slotsEl.append(slot);
  padBtns.push(padBtn); oscSels.push(sel);
}

function refreshSlot(i) {
  const e = bank[i], btn = padBtns[i];
  if (!e) {
    btn.textContent = '· empty ·';
    btn.className = 'pad-btn';
    btn.style.background = '';
    return;
  }
  btn.textContent = e.name + '\n' + e.notes.map(noteStr).join(' ');
  btn.className = 'pad-btn filled' + (active[i] ? ' on' : '');
  btn.style.background = active[i] ? PAD_COLORS[i] : '';
}

function soundingLine() {
  const names = bank.filter((e, j) => e && active[j]).map(e => e.name);
  status.textContent = names.length ? 'sounding: ' + names.join('  +  ') : '· all pads breathing out ·';
}

async function loadPad(i) {
  const notes = [...selection].sort((a, b) => a - b);
  if (!notes.length) { status.textContent = 'click notes on the keyboard first'; return; }
  await ensureAudio();
  if (bank[i]) { bank[i].stopAfter = now(); livePads.delete(bank[i]); }  // replaced pad stops; orbit resets below
  const pad = {
    slot: i, name: chordName(notes), notes, osc: +oscSels[i].value,
    params: { ...DEFAULTS },
    loopTime: 0.35 + Math.random() * 0.6,
    walks: { weather: 0, warp: 0, fm: 0.8, breathe: [] },
    nextAt: now() + 0.05, stopAfter: null,
  };
  bank[i] = pad;
  livePads.add(pad);
  padMemories[i]?.set(pad.params.fbAmt, pad.loopTime, 0.02);  // snap, pre-sound
  // first event creates the orbit; then zero its gain and bloom in
  fireCycle(pad, pad.nextAt); pad.nextAt += CYCLE;
  const out = orbitOut(i);
  if (out) { out.gain.cancelScheduledValues(now()); out.gain.value = 0.0001; }
  active[i] = true;
  setPadLevel(pad, 1);
  refreshSlot(i);
  selectTarget(i);
  status.textContent = `pad ${i + 1} = ${pad.name} — fading in; inspector is now on it`;
}

function togglePad(i) {
  if (!bank[i]) { status.textContent = 'empty slot — build a chord on the keys, then LOAD'; return; }
  active[i] = !active[i];
  const pad = bank[i];
  if (active[i]) { pad.stopAfter = null; pad.nextAt = now() + 0.05; livePads.add(pad); }
  else pad.stopAfter = now() + pad.params.fall * 1.4;   // keep weaving through the exhale
  setPadLevel(pad, active[i] ? 1 : 0);
  refreshSlot(i);
  soundingLine();
}

function deletePad(i) {
  const pad = bank[i];
  if (!pad) return;
  status.textContent = `pad ${i + 1} (${pad.name}) deleted — long exhale`;
  setPadLevel(pad, 0);
  pad.stopAfter = now() + pad.params.fall * 1.4;   // tail keeps weaving via livePads
  active[i] = false;
  bank[i] = null;
  refreshSlot(i);
  if (target === i) selectTarget('all');
}

document.getElementById('clear').addEventListener('click', () => { selection.clear(); updateReadout(); });
document.getElementById('hear').addEventListener('click', async () => {
  await ensureAudio();
  [...selection].sort((a, b) => a - b).forEach((m, k) => setTimeout(() => ping(m, 0.12), k * 60));
});
document.getElementById('fadeall').addEventListener('click', () => {
  bank.forEach((e, i) => {
    if (!e) return;
    if (active[i]) { active[i] = false; e.stopAfter = now() + e.params.fall * 1.4; setPadLevel(e, 0); }
    refreshSlot(i);
  });
  status.textContent = '→ every pad breathing out at its own fall time';
});

// ── PAD INSPECTOR — buttons 1-6 target ONE pad; ALL targets every pad
//    and sets the defaults new pads inherit. Sliders JUMP to whichever
//    pad is selected. Param changes land on the next weave cycle (≤3s);
//    rise/fall land at the next toggle. ──
let target = 'all';
const inspRegistry = {};   // key → {input, val, spec, mapper}
const inspTitle = document.getElementById('insp-title');
const targetBtnsEl = document.getElementById('target-btns');
const inspGrid = document.getElementById('insp-grid');
const targetBtns = [];

function setPadParam(key, v) {
  if (target === 'all') {
    DEFAULTS[key] = v;
    bank.forEach(pad => { if (pad) pad.params[key] = v; });
  } else if (bank[target]) {
    bank[target].params[key] = v;
  } else {
    status.textContent = `pad ${target + 1} is empty — LOAD a chord first`;
  }
}

function selectTarget(t) {
  target = t;
  targetBtns.forEach((b, k) => {
    b.classList.toggle('on', (t === 'all' && k === N_SLOTS) || t === k);
  });
  inspTitle.textContent = 'PAD INSPECTOR — editing ' +
    (t === 'all' ? 'ALL PADS (+ defaults for new pads)'
      : `pad ${t + 1}` + (bank[t] ? ` (${bank[t].name})` : ' (empty — showing defaults)'));
  const src = (t !== 'all' && bank[t]) ? bank[t].params : DEFAULTS;
  for (const [key, r] of Object.entries(inspRegistry)) {
    r.input.value = Math.round(r.mapper.unmap(src[key]) * 1000);
    r.val.textContent = fmtParam(key, src[key]);
  }
}

function fmtParam(key, v) {
  return (key === 'cutoff') ? String(Math.round(v)) : v.toFixed(v >= 10 ? 1 : 2);
}

for (let i = 0; i <= N_SLOTS; i++) {
  const b = document.createElement('button');
  b.className = 'tbtn';
  b.textContent = i < N_SLOTS ? String(i + 1) : 'ALL';
  b.addEventListener('click', () => selectTarget(i < N_SLOTS ? i : 'all'));
  targetBtnsEl.append(b);
  targetBtns.push(b);
}

{
  let lastGroup = null;
  for (const spec of PAD_SPECS) {
    if (spec.group !== lastGroup) {
      const hdr = document.createElement('div');
      hdr.className = 'insp-sec';
      hdr.textContent = spec.group;
      inspGrid.append(hdr);
      lastGroup = spec.group;
    }
    const mapper = specMap(spec);
    const row = document.createElement('label');
    row.className = 'fx-row';
    const name = document.createElement('span');
    name.textContent = spec.label;
    const input = document.createElement('input');
    input.type = 'range'; input.min = 0; input.max = 1000; input.step = 1;
    input.value = Math.round(mapper.unmap(DEFAULTS[spec.key]) * 1000);
    const val = document.createElement('span');
    val.className = 'fx-val';
    val.textContent = fmtParam(spec.key, DEFAULTS[spec.key]);
    input.addEventListener('input', () => {
      const v = mapper.map(input.value / 1000);
      val.textContent = fmtParam(spec.key, v);
      setPadParam(spec.key, v);
    });
    row.append(name, input, val);
    inspGrid.append(row);
    inspRegistry[spec.key] = { input, val, spec, mapper };
  }
}

// ── FX — SHARED AIR (defaults = the SC room's ~fx) ──
const FX_SPECS = [
  { key: 'echoTime', label: 'echo time', lo: 0.08, hi: 1.3, curve: 'exp', def: 0.45 },
  { key: 'echoFb',   label: 'echo feed', lo: 0, hi: 0.8, curve: 'lin', def: 0.35 },
  { key: 'echoMix',  label: 'echo mix',  lo: 0, hi: 1, curve: 'lin', def: 0 },
  { key: 'shimmer',  label: 'shimmer',   lo: 0, hi: 0.5, curve: 'lin', def: 0 },
  { key: 'humidity', label: 'humidity',  lo: 0, hi: 0.95, curve: 'lin', def: 0.55 },
  { key: 'darkness', label: 'darkness',  lo: 0, hi: 1, curve: 'lin', def: 0.6 },
  { key: 'width',    label: 'width',     lo: 0.5, hi: 1.7, curve: 'lin', def: 1.2 },
  { key: 'vol',      label: 'master',    lo: 0, hi: 1.5, curve: 'lin', def: 1 },
];
const fxState = Object.fromEntries(FX_SPECS.map(s => [s.key, s.def]));
const fxGrid = document.getElementById('fx-grid');
const fxRegistry = {};   // key → {input, val, mapper} — so bank restore can move sliders
for (const spec of FX_SPECS) {
  const mapper = specMap(spec);
  const row = document.createElement('label');
  row.className = 'fx-row';
  const name = document.createElement('span');
  name.textContent = spec.label;
  const input = document.createElement('input');
  input.type = 'range'; input.min = 0; input.max = 1000; input.step = 1;
  input.value = Math.round(mapper.unmap(spec.def) * 1000);
  const val = document.createElement('span');
  val.className = 'fx-val';
  val.textContent = spec.def.toFixed(2);
  input.addEventListener('input', () => {
    const v = mapper.map(input.value / 1000);
    fxState[spec.key] = v;
    val.textContent = v.toFixed(2);
    if (room) room.set(spec.key, v);
  });
  row.append(name, input, val);
  fxGrid.append(row);
  fxRegistry[spec.key] = { input, val, mapper };
}
function refreshFxSliders() {
  for (const [key, r] of Object.entries(fxRegistry)) {
    r.input.value = Math.round(r.mapper.unmap(fxState[key]) * 1000);
    r.val.textContent = fxState[key].toFixed(2);
  }
}

// ── BANK PERSISTENCE — pads + per-pad settings + fx desk + defaults,
//    v2 field set from the SC loom. Auto-restores on launch (silent —
//    "toggle them on"), like the SC console does. ──
const BANK_KEY = 'chord-loom-bank-v2';

function saveBank() {
  const data = {
    pads: bank.map(e => e ? { name: e.name, notes: e.notes, osc: e.osc, params: { ...e.params } } : null),
    fx: { ...fxState },
    defaults: { ...DEFAULTS },
  };
  localStorage.setItem(BANK_KEY, JSON.stringify(data));
  status.textContent = 'bank + settings + fx desk saved — auto-restores on launch';
}

function restoreBank(announce = true) {
  const raw = localStorage.getItem(BANK_KEY);
  if (!raw) { if (announce) status.textContent = 'no saved bank yet — SAVE BANK writes one'; return; }
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  if (data.defaults) Object.assign(DEFAULTS, data.defaults);
  if (data.fx) {
    Object.assign(fxState, data.fx);
    refreshFxSliders();
    if (room) for (const [k, v] of Object.entries(fxState)) room.set(k, v);
  }
  (data.pads || []).forEach((row, i) => {
    if (!row || i >= N_SLOTS) return;
    if (bank[i]) { bank[i].stopAfter = audioUp ? now() : 0; livePads.delete(bank[i]); }
    bank[i] = {
      slot: i, name: row.name, notes: row.notes, osc: row.osc ?? 0,
      params: { ...DEFAULTS, ...row.params },
      loopTime: 0.35 + Math.random() * 0.6,
      walks: { weather: 0, warp: 0, fm: 0.8, breathe: [] },
      nextAt: 0, stopAfter: null,
    };
    active[i] = false;
    oscSels[i].value = String(bank[i].osc);
    if (audioUp) {
      const out = orbitOut(i);
      if (out) { out.gain.cancelScheduledValues(now()); out.gain.value = 0.0001; }
    }
    refreshSlot(i);
  });
  selectTarget(target);
  if (announce) status.textContent = `bank restored (${bank.filter(Boolean).length} pads, silent) — toggle them on`;
}

document.getElementById('btn-save').addEventListener('click', saveBank);
document.getElementById('btn-reload').addEventListener('click', async () => {
  await ensureAudio();
  restoreBank();
});

// ── RECORD — taps the room post-limiter, downloads a take ──
const recBtn = document.getElementById('btn-rec');
let recorder = null;

recBtn.addEventListener('click', async () => {
  await ensureAudio();
  if (!recorder) {
    const ctx = getAudioContext();
    const dest = ctx.createMediaStreamDestination();
    room._limiter.connect(dest);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    const chunks = [];
    recorder = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const ext = (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
      a.download = 'chord-loom-take.' + ext;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      room._limiter.disconnect(dest);
      recorder = null;
    };
    recorder.start();
    recBtn.textContent = '■ stop & save';
    recBtn.classList.add('recording');
    status.textContent = 'recording the room…';
  } else {
    recorder.stop();
    recBtn.textContent = '● record output';
    recBtn.classList.remove('recording');
    status.textContent = 'take saved — check your downloads';
  }
});

// ── guide flyout ──
const guideOpen = (on) => document.body.classList.toggle('guide-open', on);
document.getElementById('btn-guide').addEventListener('click', () => guideOpen(true));
document.getElementById('guide-veil').addEventListener('click', () => guideOpen(false));
document.getElementById('guide-close').addEventListener('click', () => guideOpen(false));
window.addEventListener('keydown', e => { if (e.key === 'Escape') guideOpen(false); });

drawKb();
selectTarget('all');
restoreBank(false);   // silent auto-restore, SC-style

// debug hooks for the headless test harness
window.LOOM = {
  toggleNote, loadPad, togglePad, chordName, ensureAudio,
  ctx: () => getAudioContext(),
  orbitOut, state: () => ({ bank, active }),
  room: () => room, fxState,
  selectTarget, setPadParam, getTarget: () => target, defaults: DEFAULTS,
};
