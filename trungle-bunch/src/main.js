import { Engine } from './audio.js';
import { Network } from './network.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';
import { clamp, rand } from './util.js';
import { SCALE } from './tuning.js';
import { VR_MIN, VR_MAX } from './triangle.js';

const canvas = document.getElementById('stage');
const veil = document.getElementById('veil');
const hud = document.getElementById('hud');

const engine = new Engine();
const net = new Network(engine);
const renderer = new Renderer(canvas, net);

// Seed a small colony so the culture is already alive behind the veil.
(function seed() {
  const cx = renderer.w / 2;
  const cy = renderer.h / 2;
  const spread = Math.min(renderer.w, renderer.h) * 0.19;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand(0.6);
    net.germinate(cx + Math.cos(a) * spread, cy + Math.sin(a) * spread * 0.8, {
      grown: true,
      z: rand(0.3, -0.3),
    });
  }
})();

// ————— title screen —————
// The colony keeps growing behind the veil and the audio only ducks, so the
// title is a step back from the instrument rather than a stop.

let titleUp = true;
let everPlayed = false;

function showTitle() {
  titleUp = true;
  veil.classList.remove('gone');
  veil.setAttribute('aria-hidden', 'false');
  net.mouse.inside = false;
  engine.duck(true);
}

async function hideTitle(x, y) {
  veil.classList.add('gone');
  veil.setAttribute('aria-hidden', 'true');
  try {
    await engine.start();
  } catch (e) {
    veil.classList.remove('gone');
    veil.setAttribute('aria-hidden', 'false');
    hud.textContent = 'audio blocked — click the page once more to let the browser start sound';
    return;
  }
  engine.duck(false);
  titleUp = false;
  // only the very first entry plants something; coming back leaves the colony be
  if (!everPlayed) {
    everPlayed = true;
    net.germinate(x, y);
  }
}

attachInput(canvas, net, {
  titleUp: () => titleUp,
  dismiss: (x, y) => hideTitle(x, y),
});

// handles for inspection while tuning the instrument
window.MTS = { engine, net, renderer };

// which colour pairs are currently voicing, most common first
function droneName() {
  const counts = new Map();
  for (const t of net.tris) counts.set(t.combo, (counts.get(t.combo) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return top.length ? top.map(([n, c]) => `${n}\u00d7${c}`).join('   ') : 'quiet';
}

// the swirl gesture, read back so it is discoverable that it does anything
function stirName() {
  const st = net.stereoNow();
  if (st.swirl < 0.05) return 'still';
  const bars = '\u2588'.repeat(1 + Math.round(st.swirl * 4));
  return `${st.spin > 0 ? 'clockwise' : 'widdershins'} ${bars}`;
}

let hudClock = 0;
function writeHud() {
  const spirit = net.spirit;
  const name = spirit > 0.18 ? 'ascendant' : spirit < -0.18 ? 'rooted' : 'level';
  const sign = spirit >= 0 ? '+' : '−';
  hud.innerHTML =
    `<span>time</span>${net.flow.toFixed(2)}×\n` +
    `<span>gravity</span>${sign}${Math.abs(spirit).toFixed(2)}  ${name}\n` +
    `<span>network</span>${net.tris.length} nodes   ${net.liveConnCount()} threads   ${engine.activeCount()} voices\n` +
    `<span>drone</span>${net.bedVoices ?? 0} of 4   ` +
    `${Math.round((net.bedLevel ?? 0) * 294)}%   ` +
    `${net.bedDuck < 0.75 ? 'ducked' : 'open'}\n` +
    `<span>voicing</span>${droneName()}\n` +
    `<span>stir</span>${stirName()}${net.frozen ? '     held' : ''}`;
}

let prev = performance.now();
function frame(now) {
  const dt = clamp((now - prev) / 1000, 0, 0.05);
  prev = now;

  net.step(dt);
  engine.tick();
  renderer.draw();

  hudClock -= dt;
  if (hudClock <= 0) {
    hudClock = 0.16;
    writeHud();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) engine.suspend();
  else engine.resume();
});

/**
 * The keyboard. Not controls for the instrument's voice — the cursor still owns
 * all of that. These are stage directions: what is on it, how fast it lives,
 * which way it leans, and how big everything is.
 */
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

  // Space silences the colony without erasing it — a way back from a loud tangle.
  if (ev.code === 'Space') {
    ev.preventDefault();
    net.pulses.length = 0;
    for (const t of net.tris) t.nutrient = 0;
    return;
  }

  // Escape returns to the title, which doubles as the gesture reference.
  if (ev.code === 'Escape') {
    ev.preventDefault();
    if (titleUp) hideTitle(net.width / 2, net.height / 2);
    else showTitle();
    return;
  }

  if (titleUp) return;

  // 1–6 plant a body already voiced for one of the six colour pairs, so the
  // colony's instrumentation can be composed rather than only stumbled into.
  if (/^Digit[1-6]$/.test(ev.code)) {
    ev.preventDefault();
    const pair = Number(ev.code.slice(5)) - 1;
    seedVoiced(pair);
    return;
  }

  switch (ev.code) {
    // step the two axes, for when a sweep is too coarse
    case 'ArrowRight':
      ev.preventDefault();
      net.sweepX += 42;
      break;
    case 'ArrowLeft':
      ev.preventDefault();
      net.sweepX -= 42;
      break;
    case 'ArrowUp':
      ev.preventDefault();
      net.sweepY -= 34;
      break;
    case 'ArrowDown':
      ev.preventDefault();
      net.sweepY += 34;
      break;

    // grow and shrink every body at once — the fastest way into the large voices
    case 'BracketRight':
      ev.preventDefault();
      scaleAll(1.22);
      break;
    case 'BracketLeft':
      ev.preventDefault();
      scaleAll(1 / 1.22);
      break;

    // hold the mycelium still: threads stop growing and rotting, sound continues
    case 'KeyF':
      ev.preventDefault();
      net.frozen = !net.frozen;
      break;

    // scatter the colony without losing it
    case 'KeyR':
      ev.preventDefault();
      for (const t of net.tris) {
        t.vx += rand(420, -420);
        t.vy += rand(300, -300);
      }
      break;
    default:
      break;
  }
});

/** Plant a body whose edges land in a chosen colour pair. */
function seedVoiced(pair) {
  const m = net.mouse.inside ? net.mouse : { x: net.width / 2, y: net.height / 2 };
  const t = net.germinate(m.x + rand(90, -90), m.y + rand(90, -90));
  if (!t) return;
  // Channel comes from pitch class, so choosing degrees chooses the colour — and
  // therefore the voice. Third of the octave per channel.
  const want = [
    [0, 0],
    [1, 1],
    [2, 2],
    [0, 1],
    [0, 2],
    [1, 2],
  ][pair];
  const forChannel = (ch) => {
    // scale degrees whose cents fall in this channel's third of the octave
    const lo = (ch * 1200) / 3;
    const hi = ((ch + 1) * 1200) / 3;
    const opts = SCALE.map((c, i) => [c, i]).filter(([c]) => c >= lo && c < hi);
    return (opts.length ? opts[(Math.random() * opts.length) | 0][1] : 0);
  };
  t.edges[0].degree = forChannel(want[0]);
  t.edges[1].degree = forChannel(want[1]);
  t.edges[2].degree = forChannel(want[Math.random() < 0.5 ? 0 : 1]);
  for (const e of t.edges) e.octave = 0;
}

function scaleAll(k) {
  for (const t of net.tris) {
    for (let i = 0; i < 3; i++) t.vr[i] = clamp(t.vr[i] * k, VR_MIN, VR_MAX);
    t.recomputeLocal();
  }
}
