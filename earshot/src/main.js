// Wiring and the run loop.
//
// The boot sequence advances by itself: the soundmap is asked which open
// microphones are live, the furthest-apart set is chosen, each stream is opened,
// and every recommended setting is applied as it is reached. The only thing that
// needs a human is the first gesture, which browsers require before any audio
// may start.
//
// Add ?mic=1 to also analyse the local microphone as an extra channel. It is off
// by default: the subject of this piece is elsewhere.

import { CONFIG } from './core/config.js';
import { formatClock } from './core/util.js';
import { Engine } from './audio/engine.js';
import { Synth } from './audio/synth.js';
import { Conductor } from './orchestra/conductor.js';
import { Renderer } from './visual/renderer.js';
import { Bloom } from './visual/bloom.js';
import { Contour } from './visual/contour.js';
import { WorldMap } from './ui/worldmap.js';
import { MixerPanel } from './ui/mixerpanel.js';
import { Panel } from './ui/panel.js';
import { Locations } from './ui/locations.js';
import { ViewMenu } from './ui/viewmenu.js';
import { VIEWS, DEFAULT_VIEW, viewById } from './ui/views.js';
import { loadSources, spread, minSeparationKm, liveOnly } from './audio/sources.js';
import { openStreams, isUnrouted } from './audio/remote.js';
import { requestAccess, listInputDevices, openDevices } from './audio/inputs.js';
import { Recorder, recordingName, download, formatSize } from './audio/recorder.js';

const STEP_PAUSE = 320;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);
const WANT_LOCAL_MIC = params.get('mic') === '1';
const SOURCE_COUNT = Math.max(1, Number(params.get('mics')) || CONFIG.sources.count);
// ?seed=anything reproduces a selection; without it every session is different.
const SEED = params.get('seed');

const state = {
  engine: null,
  synth: null,
  conductor: null,
  renderer: null,
  panel: null,
  streams: [],
  library: [],
  locations: null,
  bloom: null,
  map: null,
  mixer: null,
  contour: null,
  viewMenu: null,
  recorder: null,
  view: DEFAULT_VIEW,
  running: false,
  startedMs: 0,
};

const panel = new Panel({ onStart: () => boot() });
state.panel = panel;

// Nothing here needs a permission prompt. Audio still needs a gesture, so try to
// start without one and fall back to the button.
(async function considerAutoStart() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const probe = new Ctx();
  await probe.resume().catch(() => {});
  const canAutoStart = probe.state === 'running';
  probe.close().catch(() => {});
  if (canAutoStart) {
    panel.hideStart();
    boot();
  }
})();

async function boot() {
  if (state.running) return;
  state.running = true;
  panel.hideStart();

  try {
    // 1 — audio context
    panel.step('context', 'active');
    panel.bootStatus('Opening the audio context…');
    const engine = new Engine();
    await engine.init();
    state.engine = engine;
    panel.step('context', 'done', `${Math.round(engine.ctx.sampleRate / 1000)} kHz · ${engine.ctx.state}`);
    await sleep(STEP_PAUSE);

    // 2 — who is listening, right now
    panel.step('registry', 'active');
    panel.bootStatus('Asking the soundmap which microphones are live…');
    const { sources, live, note } = await loadSources({ timeoutMs: CONFIG.sources.listTimeoutMs });
    panel.step('registry', live ? 'done' : 'failed', note);
    await sleep(STEP_PAUSE);

    // 3 — the furthest-apart set
    panel.step('selection', 'active');
    // Ask for more candidates than channels: some streams will refuse to open,
    // and the greedy spread already has them in best-first order.
    state.library = sources;
    state.map = new WorldMap(document.getElementById('map'));
    state.map.setSources(sources);
    const seed = SEED ?? (CONFIG.sources.randomStart ? null : 'fixed');
    // The library carries the whole archive; only what is awake can be chosen.
    const awake = liveOnly(sources);
    const candidates = spread(awake, Math.min(awake.length, SOURCE_COUNT * 3), { seed });
    const intended = candidates.slice(0, SOURCE_COUNT);
    panel.step('selection', 'done',
      `${intended.map((s) => s.city).join(' · ')} — ${Math.round(minSeparationKm(intended)).toLocaleString('en-US')} km apart`
      + (SEED ? ` · seed "${SEED}"` : ' · random start'));
    await sleep(STEP_PAUSE);

    // 4 — open the streams
    panel.step('connect', 'active');
    await ensureVisible(panel);
    const streams = await openStreams(engine.ctx, candidates, SOURCE_COUNT, {
      pool: engine.mediaPool,
      onNote: (text) => panel.bootStatus(text),
      onState: (source, streamState, detail) => {
        const index = state.engine.channels.findIndex((c) => c.meta?.url === source.url);
        if (index >= 0) panel.setChannelState(index, streamState, detail);
      },
    });
    if (!streams.length) throw new Error('No open microphone could be reached. Check the network and try again.');
    state.streams = streams;
    panel.step('connect', 'done', `${streams.length} of ${SOURCE_COUNT} streaming`);
    await sleep(STEP_PAUSE);

    // 5 — channels
    panel.step('channels', 'active');
    streams.forEach((stream) => engine.addRemote(stream, stream.source));
    if (WANT_LOCAL_MIC) await addLocalMic(engine, panel);
    setupLibrary();
    setupDock(engine);
    refreshChannels();
    panel.step('channels', 'done', `${engine.channels.length} live channel${engine.channels.length === 1 ? '' : 's'}`);
    await sleep(STEP_PAUSE);

    // 6 — analysis
    panel.step('analysis', 'active');
    panel.step('analysis', 'done',
      `${CONFIG.audio.bands} bands · ${CONFIG.audio.fMin}–${Math.round(CONFIG.audio.fMax / 1000)}k · ${CONFIG.audio.frameHz} fps`);
    await sleep(STEP_PAUSE);

    // 7 — pattern library
    panel.step('patterns', 'active');
    panel.step('patterns', 'done', 'loaded · matching live');
    await sleep(STEP_PAUSE);

    // 8 — orchestration
    panel.step('orchestra', 'active');
    const synth = new Synth(engine).init();
    const conductor = new Conductor(engine, synth);
    conductor.onEvent = (e) => panel.markPattern(e.patternId, e.confidence);
    conductor.narrator.onEntry = (entry) => panel.addEntry(entry, state.startedMs);
    state.synth = synth;
    state.conductor = conductor;
    panel.step('orchestra', 'done', 'associative layer on · memory empty');
    await sleep(STEP_PAUSE);

    // 9 — visualiser
    panel.step('visual', 'active');
    const renderer = new Renderer(document.getElementById('stage'));
    renderer.syncLayers(engine.channels);
    state.renderer = renderer;
    state.bloom = new Bloom(document.getElementById('bloom'));
    state.contour = new Contour(document.getElementById('contour'));
    state.viewMenu = new ViewMenu({ onSelect: (id) => setView(id) });
    setView(state.view);
    panel.step('visual', 'done', `${engine.channels.length} stacked layer${engine.channels.length === 1 ? '' : 's'}`);
    panel.bootStatus('Listening.');
    await sleep(STEP_PAUSE * 1.4);

    state.startedMs = performance.now();
    conductor.startedMs = state.startedMs;
    panel.hideBoot();
    requestAnimationFrame(loop);
  } catch (err) {
    state.running = false;
    console.error(err);
    panel.fail(explain(err));
  }
}

// How long one reading takes to give way to the next. The outgoing canvas is no
// longer being drawn, so what fades out is its last frame — which is why this is
// short enough to read as a dissolve and not as a freeze.
const VIEW_FADE_MS = 420;

function setView(id) {
  const view = viewById(id);
  state.view = view.id;

  for (const v of VIEWS) {
    const el = document.getElementById(v.canvas);
    if (v.id === view.id) {
      clearTimeout(el._fade);
      el.hidden = false;
      // Display has to come back before opacity can be transitioned from it —
      // in one frame the browser has nothing to animate from.
      requestAnimationFrame(() => { el.dataset.shown = '1'; });
    } else if (!el.hidden) {
      el.dataset.shown = '0';
      clearTimeout(el._fade);
      el._fade = setTimeout(() => { if (state.view !== v.id) el.hidden = true; }, VIEW_FADE_MS);
    }
  }
  // The frequency/time/amplitude labels describe the ridge plot only.
  document.querySelector('.stage__axes').hidden = !view.axes;
  document.querySelector('.stage__caption').textContent = view.caption;
  state.viewMenu?.setActive(view.id);
}

/**
 * The two controls that stay on screen: the mixer, and keeping what you heard.
 *
 * Recording taps the master, so a file holds exactly what the room held — the world,
 * the layers the piece generated from it, and the reverb they share.
 */
function setupDock(engine) {
  const button = document.getElementById('record');
  const meter = document.getElementById('record-meter');
  if (!button) return;

  const show = (rec) => {
    meter.hidden = !rec.recording;
    meter.textContent = `${formatClock(rec.seconds * 1000)} · ${formatSize(rec.bytes)}`;
  };

  const recorder = new Recorder(engine.ctx, engine.master, {
    onTick: (rec) => {
      // Redrawn about twice a second, not on every 128-sample block.
      if (rec.frames - (recorder._shownAt ?? 0) > engine.ctx.sampleRate / 2) {
        recorder._shownAt = rec.frames;
        show(rec);
      }
    },
    onLimit: () => finish('that is twenty minutes — saved before the tab runs out of memory'),
  });
  state.recorder = recorder;

  function finish(note) {
    const result = recorder.stop();
    button.setAttribute('aria-pressed', 'false');
    button.textContent = 'record';
    meter.hidden = true;
    if (!result) { state.panel.warn('nothing was recorded'); return; }
    const places = state.engine.channels.map((c) => c.meta?.city).filter(Boolean);
    const name = recordingName(places, new Date(), result.seconds);
    download(result.blob, name);
    state.panel.warn(note ?? `saved ${name} — ${formatSize(result.blob.size)}`);
  }

  button.disabled = false;
  button.addEventListener('click', async () => {
    if (recorder.recording) { finish(); return; }
    try {
      button.disabled = true;
      await recorder.start();
      button.setAttribute('aria-pressed', 'true');
      button.textContent = 'stop';
      show(recorder);
      state.panel.warn('recording what you hear — tap stop to keep it');
    } catch (err) {
      state.panel.warn(`recording is not available here (${err.message})`);
    } finally {
      button.disabled = false;
    }
  });
}

/** Build the browsable library and hand it the actions it can take. */
function setupLibrary() {
  state.locations = new Locations({
    onToggle: (source) => toggleLocation(source),
    onRandom: () => randomSpread(),
    onClose: () => {},
  });
  state.locations.setSources(state.library);

  state.mixer = new MixerPanel({
    onChange: (note) => { if (note) state.panel.warn(note); },
  });
  state.mixer.attach(state.engine);
  state.panel.onMixerOpen = () => state.mixer.toggle();

  state.panel.onLibraryOpen = () => state.locations.toggle();
  state.panel.onRemoveChannel = (channel) => {
    if (state.engine.channels.length <= 1) {
      state.panel.warn('that is the last place — add another before taking this one off');
      return;
    }
    removeLocation(channel);
  };
}

/** Everything that has to happen after the set of channels changes. */
function refreshChannels() {
  const { engine, panel, renderer, locations } = state;
  panel.setChannels(engine.channels);
  panel.setSpread(minSeparationKm(engine.channels.map((c) => c.meta).filter((m) => Number.isFinite(m?.lat))));
  panel.setCapacity(engine.atCapacity);
  renderer?.syncLayers(engine.channels);
  locations?.update(engine.channels);
  state.map?.setActive(engine.channels);
  engine.applyMix();
  state.mixer?.setChannels(engine.channels);
  engine.channels.forEach((ch, i) => {
    if (ch.stream) panel.setChannelState(i, ch.stream.state);
  });
}

/** Add a place, or take it out again. Immediate — no apply step. */
async function toggleLocation(source) {
  const { engine } = state;
  const existing = engine.channels.find((c) => c.meta?.sourceId === source.id);

  if (existing) {
    if (engine.channels.length <= 1) {
      state.panel.warn('that is the last microphone — add another before removing this one');
      return;
    }
    removeLocation(existing);
    return;
  }

  if (engine.atCapacity) {
    state.panel.warn(`at capacity (${CONFIG.sources.max} places) — remove one first`);
    return;
  }

  state.panel.warn(`connecting to ${source.place}…`);
  const [stream] = await openStreams(engine.ctx, [source], 1, {
    pool: engine.mediaPool,
    onNote: (text) => state.panel.warn(text),
  });
  if (!stream) {
    state.panel.warn(`${source.place} would not open — it may have gone offline`);
    state.locations?.markUnavailable(source, 'would not open');
    state.locations?.update(engine.channels);
    return;
  }
  state.locations?.clearUnavailable(source);
  state.streams.push(stream);
  engine.addRemote(stream, source);
  state.panel.warn('');
  refreshChannels();
}

function removeLocation(channel) {
  const { engine } = state;
  state.streams = state.streams.filter((s) => s !== channel.stream);
  engine.removeChannel(channel);
  state.panel.warn('');
  refreshChannels();
}

/** Draw a fresh spread set: keep nothing, start somewhere else in the world. */
async function randomSpread() {
  const { engine } = state;
  const want = Math.min(SOURCE_COUNT, CONFIG.sources.max);
  const awake = liveOnly(state.library);
  const candidates = spread(awake, Math.min(awake.length, want * 3));
  const wanted = new Set(candidates.slice(0, want).map((s) => s.id));

  // Keep anything already playing that the new set also wants; drop the rest.
  for (const channel of [...engine.channels]) {
    if (!channel.meta?.sourceId || !wanted.has(channel.meta.sourceId)) removeLocation(channel);
  }
  const have = new Set(engine.channels.map((c) => c.meta?.sourceId));
  const toOpen = candidates.filter((s) => !have.has(s.id));

  state.panel.warn('drawing a new set…');
  const opened = await openStreams(engine.ctx, toOpen, want - engine.channels.length, {
    pool: engine.mediaPool,
    onNote: (text) => state.panel.warn(text),
  });
  opened.forEach((stream) => {
    state.streams.push(stream);
    engine.addRemote(stream, stream.source);
  });
  state.panel.warn('');
  refreshChannels();
}

/**
 * Browsers do not decode media in a background tab: a stream opened there sits
 * at readyState 0 forever and every timeout in the world only turns it into a
 * failure. Wait for the tab to be looked at, and say why.
 */
async function ensureVisible(ui) {
  if (document.visibilityState === 'visible') return;
  ui.bootStatus('This tab is in the background — browsers will not decode audio there. Bring it to the front and this continues on its own.');
  await new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
  ui.bootStatus('Thank you. Opening the streams…');
}

/** Opt-in extra: the local microphone, analysed but never routed to output. */
async function addLocalMic(engine, ui) {
  try {
    ui.bootStatus('Adding the local microphone as an extra channel…');
    await requestAccess();
    const devices = await listInputDevices();
    const opened = await openDevices(devices.slice(0, 1));
    opened.forEach((o, i) => engine.addDevice(o, i));
  } catch (err) {
    console.warn('local microphone skipped', err);
    ui.warn('local microphone unavailable — continuing with the open microphones');
  }
}

function explain(err) {
  switch (err.name) {
    case 'NotAllowedError':
      return 'Microphone access was refused. The open microphones do not need it — reload without ?mic=1.';
    case 'TypeError':
      return `Could not reach the microphone list: ${err.message}. Check the network and try again.`;
    default:
      return err.message || 'Something went wrong starting the piece.';
  }
}

let lastFrameMs = 0;
let frameAccumulator = 0;
let lastUiMs = 0;
let lastMotifMs = 0;
let lastHealthMs = 0;

function loop(nowMs) {
  requestAnimationFrame(loop);
  const dtMs = lastFrameMs ? Math.min(nowMs - lastFrameMs, 100) : 16;
  lastFrameMs = nowMs;

  const { engine, conductor, renderer, synth } = state;
  if (!engine || !conductor || !renderer) return;

  // Analysis runs on its own clock so the piece hears the same way at any
  // refresh rate.
  const framePeriod = 1000 / CONFIG.audio.frameHz;
  frameAccumulator += dtMs;
  let steps = 0;
  while (frameAccumulator >= framePeriod && steps < 4) {
    frameAccumulator -= framePeriod;
    steps++;
    engine.stepSpectrograms();
    conductor.step(nowMs, framePeriod / 1000);
  }

  // How far the analysis clock is through its current frame. The contour view
  // scrolls by this rather than by whole rows, which is the difference between a
  // sheet moving and a sheet jumping.
  const framePhase = Math.min(1, frameAccumulator / framePeriod);

  if (state.view === 'bloom') state.bloom.draw(engine.channels, dtMs);
  else if (state.view === 'contour') state.contour.draw(engine.channels, dtMs, framePhase);
  else renderer.draw(engine.channels, dtMs);

  // Stream health. Reconnection is handled inside RemoteStream; this only asks.
  if (nowMs - lastHealthMs > 1000) {
    lastHealthMs = nowMs;
    let trouble = 0;
    let unrouted = 0;
    engine.channels.forEach((ch, i) => {
      if (!ch.stream) return;
      const s = ch.stream.check(nowMs);
      // Pass the reason on. Without it the panel could only ever say "failed",
      // which is the least useful half of what the stream knows.
      state.panel.setChannelState(i, s, ch.stream.detail);
      if (s !== 'live') trouble++;
      // The failure that looks like success. A stream can be playing perfectly —
      // clock advancing, audible — while its audio never reaches the graph, and
      // then the piece hears nothing, draws nothing, and reports itself healthy.
      // `measured` turns true on the first frame with any finite reading in it, so
      // a few seconds of live playback without one means the route is broken.
      else if (isUnrouted(ch, nowMs)) {
        unrouted++;
        state.panel.setChannelNote(i, 'playing, but not reaching the analyser');
      }
    });
    if (engine.hasLocalMic) engine.checkFeedback(nowMs);
    const notes = [];
    if (trouble) notes.push(`${trouble} stream${trouble === 1 ? '' : 's'} reconnecting`);
    if (unrouted) notes.push(`${unrouted} playing outside the graph — the piece cannot hear ${unrouted === 1 ? 'it' : 'them'}`);
    // Nothing is audible from a suspended context, and nothing is analysed either;
    // it is worth saying rather than leaving as a mystery.
    if (engine.ctx.state !== 'running') notes.push(`audio context ${engine.ctx.state} — tap the page`);
    state.panel.warn(notes.join(' · '));
  }

  if (nowMs - lastUiMs > 120) {
    lastUiMs = nowMs;
    state.panel.updateMeters(engine.channels);
    if (state.mixer?.isOpen) state.mixer.updateMeters();
    state.panel.setStatus({
      act: conductor.narrator.act,
      tension: conductor.narrator.tension,
      elapsedMs: nowMs - state.startedMs,
      voices: synth.voices,
      ducking: nowMs < engine.duckUntil,
    });
  }

  if (nowMs - lastMotifMs > 1400) {
    lastMotifMs = nowMs;
    state.panel.setMotifs(conductor.memory.ranked());
  }
}

// Expose the running system for inspection from the console.
window.__collage = state;
