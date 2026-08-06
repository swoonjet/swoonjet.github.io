// Keeping a piece of it.
//
// The collage never repeats: the microphones are live, the selection is random, and
// what coincides at 2am in Otsuchi while it rains in Lima happens once. So the one
// thing this piece could not do was let you keep any of it.
//
// This records the master output — the world, the layers generated from it, and the
// reverb they share — straight off the graph, and writes a WAV. A WAV rather than a
// browser-negotiated codec on purpose: the format is fully determined here, it is
// identical on every platform including iOS where MediaRecorder is a lottery, and it
// drops into a DAW without a conversion step. The cost is size, which is stated on
// screen while recording rather than discovered afterwards.
//
// Recording is a TAP, never a link in the chain: the master reaches the speakers
// whether this is running or not, so nothing about the sound changes when you press
// record.

const WORKLET = 'recorder-processor';

/** Sixteen-bit stereo at the context's own rate. */
export function encodeWav(channels, sampleRate) {
  const chans = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = frames * chans * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const dv = new DataView(buf);
  const ascii = (at, text) => { for (let i = 0; i < text.length; i++) dv.setUint8(at + i, text.charCodeAt(i)); };

  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);              // PCM
  dv.setUint16(22, chans, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * chans * 2, true);
  dv.setUint16(32, chans * 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, bytes, true);

  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < chans; c++) {
      // Clamped before scaling: a sample over 1.0 would wrap to the opposite
      // extreme and read as a click rather than as loudness.
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      dv.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** A name that says what it is: the places, and when. */
export function recordingName(places, date, seconds) {
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
    + `-${two(date.getHours())}${two(date.getMinutes())}`;
  const where = places
    .map((p) => String(p || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .slice(0, 4)
    .join('_');
  const mins = Math.round(seconds / 60);
  return `earshot-${stamp}-${where || 'listening'}-${mins}min.wav`;
}

export const formatSize = (bytes) => (bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`);

export class Recorder {
  /**
   * @param source  the node to record — the master, so what is written is what was
   *                heard, generated layers and reverb included
   * @param maxSeconds a ceiling, because this is all held in memory: twenty minutes
   *                of 48 kHz stereo is about 220 MB of WAV, and a tab that dies
   *                holding an hour of someone's night has helped nobody
   */
  constructor(ctx, source, { maxSeconds = 20 * 60, onTick = () => {}, onLimit = () => {} } = {}) {
    this.ctx = ctx;
    this.source = source;
    this.maxSeconds = maxSeconds;
    this.onTick = onTick;
    this.onLimit = onLimit;
    this.recording = false;
    this.left = [];
    this.right = [];
    this.frames = 0;
    this.startedAt = 0;
    this.node = null;
  }

  get seconds() { return this.frames / this.ctx.sampleRate; }
  get bytes() { return this.frames * 4 + 44; }

  async start() {
    if (this.recording) return this;
    if (!this.node) {
      await this.ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(this.ctx, WORKLET, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      });
      this.node.port.onmessage = (e) => this.take(e.data);
      this.source.connect(this.node);
      // A worklet with no consumer is not pulled in every engine, so it is given a
      // silent one. This is what keeps the recorder a tap rather than a link.
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      this.node.connect(sink);
      sink.connect(this.ctx.destination);
      this.sink = sink;
    }
    this.left = [];
    this.right = [];
    this.frames = 0;
    this.startedAt = Date.now();
    this.recording = true;
    this.node.port.postMessage({ recording: true });
    return this;
  }

  take([left, right]) {
    if (!this.recording) return;
    this.left.push(left);
    this.right.push(right);
    this.frames += left.length;
    this.onTick(this);
    if (this.seconds >= this.maxSeconds) {
      this.onLimit(this);
    }
  }

  /** Stop and hand back the WAV, or null if nothing was captured. */
  stop() {
    if (!this.recording) return null;
    this.recording = false;
    this.node?.port.postMessage({ recording: false });
    if (!this.frames) return null;

    const blob = encodeWav([flatten(this.left, this.frames), flatten(this.right, this.frames)],
      this.ctx.sampleRate);
    const seconds = this.seconds;
    this.left = [];
    this.right = [];
    return { blob, seconds, frames: this.frames };
  }

  dispose() {
    this.recording = false;
    try { this.source.disconnect(this.node); } catch { /* already gone */ }
    try { this.node?.disconnect(); } catch { /* already gone */ }
    try { this.sink?.disconnect(); } catch { /* already gone */ }
    this.node = null;
    this.left = [];
    this.right = [];
  }
}

function flatten(blocks, frames) {
  const out = new Float32Array(frames);
  let at = 0;
  for (const b of blocks) { out.set(b, at); at += b.length; }
  return out;
}

/** Hand the file to the browser. Revoked on the next turn, never left to leak. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return url;
}
