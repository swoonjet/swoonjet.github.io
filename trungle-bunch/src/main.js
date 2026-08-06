import { Engine } from './audio.js';
import { Network } from './network.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';
import { clamp, rand } from './util.js';

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
    `<span>voicing</span>${droneName()}`;
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

window.addEventListener('keydown', (ev) => {
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
  }
});
