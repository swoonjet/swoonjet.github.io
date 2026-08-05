// The audio graph.
//
// Every source is a live microphone channel — normally an open field microphone
// somewhere in the world, streamed over the network. Each channel gets its own
// analyser (for the spectrogram) and its own rolling capture buffer (for the
// granular response layers). The response layers are therefore made of that
// place, a few seconds ago — still live material, never a file.
//
// Remote channels are audible: the piece is a live mix of the world with its own
// generated layers blooming underneath. A local microphone, if one is added, is
// analysed but never routed to the output — that way lies feedback.

import { CONFIG, CHANNEL_INKS } from '../core/config.js';
import { Smoother, clamp } from '../core/util.js';
import { Spectrogram } from './spectrogram.js';
import { ChannelStrip } from './mixer.js';
import { matchDbFor } from './levels.js';
import { shortLabel, label as deviceLabel } from './inputs.js';

/**
 * A reverb impulse generated at runtime: exponentially decaying diffuse noise.
 * Generated rather than loaded, so the project still contains no audio files.
 */
function makeImpulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const decay = Math.pow(1 - t, 2.6);
      d[i] = (Math.random() * 2 - 1) * decay * (i < 480 ? i / 480 : 1);
    }
  }
  return ir;
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.channels = [];
    this.master = null;
    this.limiter = null;
    this.outAnalyser = null;
    this.workletReady = false;
    this.duckUntil = 0;
    this.hasLocalMic = false;
    this.nextChannelId = 1;
  }

  /**
   * Channels come and go while the piece runs, so a channel's colour cannot be
   * its array index — it would shuffle every time one is removed. Take the first
   * ink nobody is using.
   */
  pickInk() {
    const taken = new Set(this.channels.map((c) => c.ink.name));
    return CHANNEL_INKS.find((ink) => !taken.has(ink.name)) ?? CHANNEL_INKS[0];
  }

  get atCapacity() {
    return this.channels.length >= Math.min(CONFIG.sources.max, CHANNEL_INKS.length);
  }

  async init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });

    // Two buses into one limiter: the world as it arrives, and the layers the
    // piece generates from it. Keeping them apart is what makes the balance
    // between them adjustable rather than baked in.
    this.responseBus = this.ctx.createGain();
    this.responseBus.gain.value = CONFIG.audio.responseGain;
    // Kept as `bus` too: the synth and the conductor were written against it.
    this.bus = this.responseBus;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -14;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.28;

    // The open microphones themselves, at a level the response can sit under.
    this.worldBus = this.ctx.createGain();
    this.worldBus.gain.value = CONFIG.audio.liveMixGain;
    this.worldBus.connect(this.limiter);
    this.liveMix = this.worldBus; // old name, same node

    // One generated space, shared by every strip. Built here rather than inside
    // the synth so the live streams can be sent to it as well as the responses.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = makeImpulse(this.ctx, CONFIG.audio.reverbSeconds);
    this.reverbReturn = this.ctx.createGain();
    this.reverbReturn.gain.value = CONFIG.audio.reverbReturn;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.limiter);

    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.safety.masterGain;

    this.outAnalyser = this.ctx.createAnalyser();
    this.outAnalyser.fftSize = 1024;
    this.outAnalyser.smoothingTimeConstant = 0.6;

    this.responseBus.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(this.outAnalyser);
    this.master.connect(this.ctx.destination);

    try {
      await this.ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
      this.workletReady = true;
    } catch (err) {
      console.warn('capture worklet unavailable; granular layer will stay silent', err);
    }

    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  /** Split one opened device into its physical channels and wire each up. */
  addDevice({ stream, device, channelCount }, deviceIndex) {
    const src = this.ctx.createMediaStreamSource(stream);
    const count = Math.max(1, Math.min(channelCount, 4));
    const splitter = count > 1 ? this.ctx.createChannelSplitter(count) : null;
    if (splitter) src.connect(splitter);

    const name = deviceLabel(device, deviceIndex);
    const made = [];
    for (let c = 0; c < count; c++) {
      const node = this.ctx.createGain();
      node.gain.value = 1;
      if (splitter) splitter.connect(node, c);
      else src.connect(node);
      made.push(this.addChannel(node, {
        name: shortLabel(name) + (count > 1 ? ` · ${c === 0 ? 'L' : c === 1 ? 'R' : c + 1}` : ''),
        place: 'here',
        deviceId: device.deviceId,
        physical: c,
        remote: false,
        audible: false, // analysed only — routing a local mic to the output howls
      }));
    }
    // Hold references so garbage collection cannot silence the stream.
    made.forEach((ch) => { ch._stream = stream; ch._src = src; ch._splitter = splitter; });
    return made;
  }

  /** One remote open microphone becomes one channel. */
  addRemote(stream, source) {
    const channel = this.addChannel(stream.node, {
      sourceId: source.id,
      name: source.city.toUpperCase(),
      place: source.place,
      city: source.city,
      country: source.country,
      detail: source.detail,
      artist: source.artist,
      lat: source.lat,
      lng: source.lng,
      url: source.url,
      remote: true,
      audible: true,
    });
    channel.stream = stream;
    return channel;
  }

  addChannel(sourceNode, meta) {
    const { ctx } = this;
    const index = this.channels.length;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = CONFIG.audio.fftSize;
    analyser.smoothingTimeConstant = CONFIG.audio.smoothing;
    sourceNode.connect(analyser);

    const spectrogram = new Spectrogram({
      bands: CONFIG.audio.bands,
      rows: CONFIG.history.rows,
      sampleRate: ctx.sampleRate,
      fftSize: CONFIG.audio.fftSize,
      fMin: CONFIG.audio.fMin,
      fMax: CONFIG.audio.fMax,
    });

    const channel = {
      // Stable for the channel's whole life. Renderer layers and event detectors
      // are keyed on it, so nothing gets another channel's history.
      id: this.nextChannelId++,
      index,
      name: meta.name,
      ink: this.pickInk(),
      trim: new Smoother(CONFIG.audio.autoTrim.halfLifeSec, 1),
      loud: 0.2,
      sourceNode,
      analyser,
      spectrogram,
      spectrum: new Float32Array(analyser.frequencyBinCount),
      live: null,
      writeHead: 0,
      level: 0,
      meta,
    };

    // Every channel gets a strip. A local mic gets one too, but its live path is
    // left disconnected from the world bus — routing a microphone in the same room
    // as the speakers to the output is how you get feedback.
    channel.strip = new ChannelStrip(ctx, sourceNode, {
      world: meta.audible === false ? ctx.createGain() : this.worldBus,
      response: this.responseBus,
      reverb: this.reverb,
    });
    if (meta.audible === false) this.hasLocalMic = true;

    if (this.workletReady) this.attachCapture(channel);
    this.channels.push(channel);
    this.reindex();
    return channel;
  }

  /** Take a channel out of the piece and release everything it held. */
  removeChannel(channel) {
    const at = this.channels.indexOf(channel);
    if (at < 0) return false;

    try { channel.stream?.destroy(); } catch { /* already gone */ }
    try { channel.strip?.dispose(); } catch { /* already gone */ }
    for (const node of [channel.captureNode, channel.analyser, channel.sourceNode]) {
      try { node?.disconnect(); } catch { /* already gone */ }
    }
    if (channel.captureNode) channel.captureNode.port.onmessage = null;
    channel.live = null;

    this.channels.splice(at, 1);
    if (channel.meta?.audible === false) {
      this.hasLocalMic = this.channels.some((c) => c.meta?.audible === false);
    }
    this.reindex();
    return true;
  }

  reindex() {
    this.channels.forEach((c, i) => { c.index = i; });
  }

  /** Solo is subtractive, so every strip has to be told when any one is soloed. */
  applyMix() {
    const soloActive = this.channels.some((c) => c.strip?.state.soloed);
    for (const c of this.channels) c.strip?.applyGains(soloActive);
    return soloActive;
  }

  /** Where the generated layers for a channel should be sent. */
  responseInputFor(channel) {
    return channel?.strip?.responseIn ?? this.responseBus;
  }

  /** The balance between the world and the piece's reply to it. */
  setBalance(world, response) {
    const now = this.ctx.currentTime;
    this.worldBus.gain.setTargetAtTime(world, now, 0.08);
    this.responseBus.gain.setTargetAtTime(response, now, 0.08);
  }

  /** Rolling live buffer, continuously overwritten by the room. */
  attachCapture(channel) {
    const { ctx } = this;
    const seconds = CONFIG.audio.liveBufferSeconds;
    channel.live = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    channel.captured = 0;

    const node = new AudioWorkletNode(ctx, 'capture-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    });
    node.port.onmessage = (e) => {
      const block = e.data;
      const buf = channel.live;
      const len = buf.length;
      let head = channel.writeHead;
      if (head + block.length <= len) {
        buf.copyToChannel(block, 0, head);
      } else {
        const first = len - head;
        buf.copyToChannel(block.subarray(0, first), 0, head);
        buf.copyToChannel(block.subarray(first), 0, 0);
      }
      channel.writeHead = (head + block.length) % len;
      channel.captured = Math.min(len, channel.captured + block.length);
    };

    const sink = ctx.createGain();
    sink.gain.value = 0; // capture only — the mic must never reach the speakers
    channel.sourceNode.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    channel.captureNode = node;
  }

  /** Advance every channel's spectrogram by one frame. */
  stepSpectrograms() {
    const trim = CONFIG.audio.autoTrim;
    const dt = 1 / CONFIG.audio.frameHz;

    for (const ch of this.channels) {
      ch.analyser.getFloatFrequencyData(ch.spectrum);
      const frame = ch.spectrogram.push(ch.spectrum);

      let sum = 0;
      for (let i = 0; i < frame.length; i++) sum += frame[i];
      ch.level = sum / frame.length;

      if (!trim.enabled) continue;
      // The untrimmed mean of this frame: what the place is doing, before we
      // interfere. Rise to a new level quickly, fall away from it slowly, so the
      // estimate tracks what a place is like rather than this instant.
      let rawSum = 0;
      const g = ch.spectrogram.gain || 1;
      for (let i = 0; i < frame.length; i++) rawSum += frame[i];
      const rawMean = rawSum / frame.length / g;

      ch.loud = rawMean > ch.loud
        ? ch.loud + (rawMean - ch.loud) * 0.06
        : ch.loud + (rawMean - ch.loud) * 0.004;

      const wanted = ch.loud > trim.floor
        ? clamp(trim.target / ch.loud, trim.minGain, trim.maxGain)
        : 1;
      ch.spectrogram.gain = ch.trim.push(wanted, dt);
    }

    this.matchLevels();
  }

  /**
   * Make the quiet places audible.
   *
   * The spectrogram's window has already made every place *visible* on the same
   * terms; this is the same idea for the ears, and it has to be a separate
   * measurement because the window is per-place — after it, a hydrophone and a
   * city square report the same band levels, so the drawing's numbers can say
   * nothing about how loud a place actually is. `loudDb` is absolute, taken from
   * the dB spectrum before any window.
   *
   * A place with nothing in it is held rather than lifted: `matchDbFor` returns
   * null for silence, and hauling a dropped stream up 18 dB and dropping it again
   * when it returns is pumping, which is audible and awful.
   */
  matchLevels() {
    const cfg = CONFIG.audio.levelMatch;
    for (const ch of this.channels) {
      if (!ch.strip) continue;
      if (!cfg.enabled) {
        if (ch.strip.matchDb !== 0) ch.strip.setMatchDb(0);
        continue;
      }
      const db = matchDbFor(ch.spectrogram.loudDb, cfg);
      if (db === null) continue;
      // A tenth of a decibel is not worth a ramp; it is worth not scheduling one.
      if (Math.abs(db - ch.strip.matchDb) > 0.1) ch.strip.setMatchDb(db);
    }
  }

  /**
   * Feedback watchdog, only meaningful when a local microphone is in the graph.
   * With remote streams there is no acoustic path back into the input, and a
   * loud stream is just a loud place — ducking it would be wrong.
   */
  checkFeedback(nowMs) {
    if (!this.outAnalyser || !this.hasLocalMic) return false;
    const bins = new Float32Array(this.outAnalyser.frequencyBinCount);
    this.outAnalyser.getFloatFrequencyData(bins);
    let peak = -Infinity;
    for (let i = 0; i < bins.length; i++) if (bins[i] > peak) peak = bins[i];

    if (peak > CONFIG.safety.howlDb) {
      this.duckUntil = nowMs + CONFIG.safety.howlDuckMs;
    }
    const ducking = nowMs < this.duckUntil;
    const target = ducking ? CONFIG.safety.masterGain * 0.12 : CONFIG.safety.masterGain;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, ducking ? 0.02 : 0.4);
    return ducking;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }
}
