// A stream the piece decodes for itself.
//
// On iOS a media element is useless to this project: it plays perfectly and hands
// the Web Audio graph absolute silence, so the piece hears nothing and draws
// nothing. Measured on the device, in all three wirings — routed after the src,
// routed before it, primed and re-pointed. A same-origin element routes fine, so it
// is cross-origin tainting rather than a general failure, and a static site has no
// way to proxy someone else's microphone.
//
// So this fetches the bytes, finds the frame edges, decodes them, and schedules the
// results back to back. The analysis then comes free: once the audio is in the graph
// as a buffer source, an analyser can see it like anything else.
//
// It presents the same surface as RemoteStream — `node`, `state`, `check`, `destroy`
// — so nothing upstream needs to know which kind of stream it has.
//
// Three details do the work, and each was a decision:
//
// 1. Every chunk is decoded WITH the previous chunk's last frame in front of it, and
//    that frame's worth of samples is then dropped. MP3 frames borrow bits from
//    their predecessors, so a chunk decoded cold starts with a frame or two of
//    starved audio — a soft blip at every seam, which on an ambient piece is the
//    only thing you would hear.
// 2. Buffers are scheduled contiguously by their own duration, never overlapped.
//    Overlapping to hide a seam sounds fine and quietly runs the clock fast — 40 ms
//    lost per 1.5 s chunk is playback 2.7% ahead of the world, which drifts into an
//    underrun and a real gap.
// 3. A 2 ms fade at each buffer edge, as insurance against a residual click. Short
//    enough not to read as a dip, long enough to kill a discontinuity.

import { alignToFrames, readHeader } from './mp3frames.js';

const STATES = ['connecting', 'live', 'stalled', 'failed'];

export class DecodedStream {
  constructor(ctx, source, {
    onState = () => {},
    maxTries = 6,
    readyTimeoutMs = 15000,
    chunkSeconds = 1.5,   // smaller means more seams, larger means more latency and
                          // more spread between places — see `check` on coincidence
    leadSeconds = 0.9,    // how far ahead of the clock to stay
    edgeFadeMs = 2,
    maxBufferBytes = 512 * 1024,
  } = {}) {
    this.ctx = ctx;
    this.source = source;
    this.onState = onState;
    this.maxTries = maxTries;
    this.readyTimeoutMs = readyTimeoutMs;
    this.chunkSeconds = chunkSeconds;
    this.leadSeconds = leadSeconds;
    this.edgeFadeMs = edgeFadeMs;
    this.maxBufferBytes = maxBufferBytes;

    this.state = 'connecting';
    this.detail = '';
    this.tries = 0;
    this.node = ctx.createGain();
    this.node.gain.value = 1;

    this.playhead = 0;        // context time where the last scheduled buffer ends
    this.scheduled = 0;
    this.underruns = 0;
    this.bytesIn = 0;
    this.lastBytesMs = 0;
    this.liveSinceMs = 0;
    this.destroyed = false;
    this.carry = new Uint8Array(0);
    this.tailFrame = null;    // last frame of the previous chunk, for the bit reservoir
    this.controller = null;
    this.sources = new Set();
  }

  setState(state, detail = '') {
    if (this.destroyed || this.state === state) return;
    if (!STATES.includes(state)) return;
    this.state = state;
    this.detail = detail;
    this.onState(state, detail, this);
  }

  /** Open the stream and resolve once audio has actually been scheduled. */
  async connect() {
    this.tries++;
    this.setState('connecting');
    this.controller = new AbortController();

    const res = await fetch(this.url(), { signal: this.controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`stream answered ${res.status}`);
    if (!res.body) throw new Error('this browser will not stream the response body');

    // The pump runs for the life of the stream and is deliberately not awaited.
    const first = new Promise((resolve, reject) => { this.firstAudio = { resolve, reject }; });
    const timer = setTimeout(
      () => this.firstAudio?.reject(new Error('timed out waiting for audio')),
      this.readyTimeoutMs,
    );
    this.pump(res.body.getReader()).catch((err) => {
      if (this.destroyed || err?.name === 'AbortError') return;
      this.firstAudio?.reject(err);
      this.retry(err.message);
    });

    try {
      await first;
    } finally {
      clearTimeout(timer);
      this.firstAudio = null;
    }

    this.liveSinceMs = performance.now();
    this.setState('live');
    return this;
  }

  /** Icecast ignores the query; it defeats any intermediate cache. */
  url() {
    return `${this.source.url}${this.source.url.includes('?') ? '&' : '?'}_=${this.tries}`;
  }

  /**
   * Read, align, decode, schedule — for as long as the stream lasts.
   *
   * Bytes are accumulated until there is a chunk's worth, which is measured in
   * seconds rather than bytes so that a 320 kbps mount and a 64 kbps one behave the
   * same. Until the first frame header arrives the bitrate is unknown, so the first
   * chunk is taken on a byte count alone.
   */
  async pump(reader) {
    let pending = [];
    let pendingBytes = 0;
    let bytesPerSecond = 0;

    for (;;) {
      const { value, done } = await reader.read();
      if (this.destroyed) return;
      if (done) throw new Error('the stream ended');

      pending.push(value);
      pendingBytes += value.length;
      this.bytesIn += value.length;
      this.lastBytesMs = performance.now();

      const want = bytesPerSecond
        ? bytesPerSecond * this.chunkSeconds
        : 48 * 1024;
      if (pendingBytes < want) continue;

      const joined = join(this.carry, ...pending);
      pending = [];
      pendingBytes = 0;

      const aligned = alignToFrames(joined);
      if (!aligned) {
        // Nothing decodable yet — keep it and read on. The cap is checked against
        // what is actually being held, carry included: measured against `pending`
        // alone it could never trip, because a stream of unalignable bytes grows the
        // carry instead and would do so until the tab ran out of memory.
        if (joined.length > this.maxBufferBytes) {
          throw new Error('no decodable audio in half a megabyte');
        }
        this.carry = joined;
        continue;
      }
      this.carry = new Uint8Array(aligned.carry);   // copied: the view outlives its buffer
      bytesPerSecond = aligned.bitrate / 8;

      await this.decodeAndSchedule(aligned);
    }
  }

  /**
   * Decode one aligned chunk, with the previous chunk's last frame in front of it,
   * and schedule what comes out.
   */
  async decodeAndSchedule(aligned) {
    const prepended = this.tailFrame;
    const withTail = prepended ? join(prepended, aligned.data) : aligned.data;
    // Keep this chunk's last frame to feed the next decode's bit reservoir.
    this.tailFrame = lastFrame(aligned.data);

    let audio;
    try {
      // `slice` because decodeAudioData detaches the buffer it is given, and these
      // bytes are a view into one still being read from.
      audio = await this.ctx.decodeAudioData(withTail.slice().buffer);
    } catch (err) {
      // One bad chunk is not a broken stream — a mount can hiccup. Drop it and
      // carry on; the health check deals with a stream that only ever fails.
      this.setState('stalled', `a chunk would not decode (${err.name || 'error'})`);
      return;
    }
    if (this.destroyed) return;

    // Drop exactly what was prepended, so the seam is continuous rather than
    // repeating a frame. decodeAudioData resamples to the context's rate, so the
    // count has to be scaled into that rate.
    this.schedule(audio, skipForPrepended(prepended, aligned.sampleRate, audio.sampleRate));
  }

  /** Put a decoded buffer on the timeline, contiguous with whatever came before. */
  schedule(audio, skipSamples = 0) {
    const ctx = this.ctx;
    const start = Math.max(skipSamples, 0);
    const length = audio.length - start;
    if (length <= 0) return;

    let buffer = audio;
    if (start > 0) {
      buffer = ctx.createBuffer(audio.numberOfChannels, length, audio.sampleRate);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        buffer.copyToChannel
          ? buffer.copyToChannel(audio.getChannelData(c).subarray(start), c)
          : buffer.getChannelData(c).set(audio.getChannelData(c).subarray(start));
      }
    }

    const now = ctx.currentTime;
    // Behind the clock means the network fell behind and the timeline has run out.
    // Resyncing leaves an audible gap, so it is counted rather than hidden.
    if (this.playhead < now + 0.02) {
      if (this.scheduled > 0) this.underruns++;
      this.playhead = now + this.leadSeconds;
    }
    const at = this.playhead;
    const dur = buffer.duration;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const fade = Math.min(this.edgeFadeMs / 1000, dur / 4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + fade);
    gain.gain.setValueAtTime(1, at + dur - fade);
    gain.gain.linearRampToValueAtTime(0, at + dur);
    src.connect(gain);
    gain.connect(this.node);
    src.start(at);

    this.sources.add(src);
    src.onended = () => { this.sources.delete(src); try { gain.disconnect(); } catch { /* gone */ } };

    this.playhead = at + dur;
    this.scheduled++;
    if (this.scheduled === 1) this.firstAudio?.resolve();
  }

  /**
   * Health, on the same terms as a media element's: is audio still arriving?
   *
   * Judged on bytes and on the timeline, never on loudness — a microphone in a wood
   * at 3am is silent and perfectly well.
   */
  check(nowMs) {
    if (this.destroyed) return this.state;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      this.lastBytesMs = nowMs;
      return this.state;
    }
    const since = nowMs - this.lastBytesMs;
    if (since > 12000) this.retry('no data for twelve seconds');
    else if (since > 5000) this.setState('stalled', 'no data');
    else if (this.ctx.currentTime > this.playhead + 0.5) this.setState('stalled', 'ran out of audio');
    else if (this.state !== 'live' && this.scheduled > 0) {
      this.setState('live');
      if (nowMs - this.liveSinceMs > 60000) { this.tries = 0; this.liveSinceMs = nowMs; }
    }
    return this.state;
  }

  async retry(reason) {
    if (this.destroyed || this.retrying) return;
    if (this.tries >= this.maxTries) {
      this.setState('failed', `${reason} — gave up after ${this.tries} tries`);
      return;
    }
    this.retrying = true;
    this.setState('stalled', reason);
    this.abort();

    const wait = Math.min(1000 * 2 ** (this.tries - 1), 30000);
    await new Promise((r) => setTimeout(r, wait));
    this.retrying = false;
    if (this.destroyed) return;
    try {
      await this.connect();
    } catch (err) {
      this.retry(err.message);
    }
  }

  abort() {
    try { this.controller?.abort(); } catch { /* already gone */ }
    this.controller = null;
    this.carry = new Uint8Array(0);
    this.tailFrame = null;
    for (const src of this.sources) { try { src.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.playhead = 0;
    this.scheduled = 0;
  }

  destroy() {
    this.destroyed = true;
    this.abort();
    try { this.node.disconnect(); } catch { /* already gone */ }
  }
}

/** The last whole frame in an aligned chunk, copied out. */
export function lastFrame(data) {
  let at = 0;
  let lastAt = -1;
  for (;;) {
    const h = readHeader(data, at);
    if (!h || at + h.length > data.length) break;
    lastAt = at;
    at += h.length;
  }
  if (lastAt < 0) return null;
  return new Uint8Array(data.subarray(lastAt, at));
}

/**
 * How many decoded samples to drop for a frame that was only prepended to feed the
 * bit reservoir. Zero when nothing was prepended — the first chunk of a stream has
 * no predecessor, and dropping a frame from it would clip the opening.
 */
export function skipForPrepended(prependedFrame, streamRate, decodedRate) {
  if (!prependedFrame) return 0;
  const h = readHeader(prependedFrame, 0);
  if (!h || !streamRate || !decodedRate) return 0;
  return Math.round(h.samples * (decodedRate / streamRate));
}

function join(...parts) {
  const total = parts.reduce((n, p) => n + (p ? p.length : 0), 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { if (p) { out.set(p, at); at += p.length; } }
  return out;
}
