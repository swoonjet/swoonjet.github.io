// Underwater.
//
// Five hydrophones in the Salish Sea, run by Orcasound: permanently installed open
// microphones, exactly like the rest of this piece's material, except that they are
// under the water and what passes them is orcas, ferries, tide and rain hitting the
// surface from below. Against a city square at rush hour they are a different
// planet, which is the whole reason to have them.
//
// They arrive differently, though, and that is what this file is for. Orcasound
// publishes HLS: a playlist of ten-second MPEG-TS segments in S3 rather than an
// endless Icecast mount. Measured from a real segment rather than assumed —
// 188-byte aligned, one audio PID, PES stream_id 0xC0, and the elementary stream
// inside is ADTS AAC, which decodeAudioData accepts on both Chrome and Safari. So
// the work is to unwrap the transport and hand the audio to the machinery that
// already exists: DecodedStream aligns, decodes and schedules, and this only
// replaces where the bytes come from.
//
// ONE HONEST COST. A ten-second segment is complete before it can be fetched, so a
// hydrophone is heard some ten to fifteen seconds behind the world, against about
// two and a half for an Icecast mount. Everything downstream still works, but the
// piece's central claim — two places inside the same three seconds — is looser for
// these channels than for the others. It cannot be fixed from this end: the audio
// does not exist any earlier. Worth it for the whales; worth saying out loud.

import { DecodedStream } from './decoded.js';

const BUCKET = 'https://audio-orcasound-net.s3.amazonaws.com';

/**
 * Verified growing on 2026-08-05: each playlist was polled twice, twelve seconds
 * apart, and only the ones that had gained segments are here. Three more nodes
 * exist and answered — orcasound_lab, sunset_bay and mast_center — with playlists
 * that had stopped advancing, so they are left out rather than offered as places
 * you cannot hear.
 */
export const HYDROPHONES = [
  { node: 'rpi_bush_point',     city: 'Bush Point',             lat: 48.0336664, lng: -122.6040035, detail: 'hydrophone, Admiralty Inlet' },
  { node: 'rpi_port_townsend',  city: 'Port Townsend',          lat: 48.135743,  lng: -122.760614,  detail: 'hydrophone, Puget Sound' },
  { node: 'rpi_north_sjc',      city: 'North San Juan Channel', lat: 48.591294,  lng: -123.058779,  detail: 'hydrophone, San Juan Channel' },
  { node: 'rpi_andrews_bay',    city: 'Andrews Bay',            lat: 48.546653,  lng: -123.166408,  detail: 'hydrophone, San Juan Island' },
  { node: 'rpi_point_robinson', city: 'Point Robinson',         lat: 47.388383,  lng: -122.37267,   detail: 'hydrophone, Maury Island' },
];

/** In the shape the rest of the piece expects a place to be. */
export const hydrophoneSources = () => HYDROPHONES.map((h) => ({
  id: `orcasound:${h.node}`,
  url: `${BUCKET}/${h.node}`,
  ext: 'hls',
  city: h.city,
  country: 'United States',
  detail: h.detail,
  artist: 'Orcasound',
  lat: h.lat,
  lng: h.lng,
  place: `${h.city}, United States`,
}));

/**
 * MPEG-TS to its elementary stream.
 *
 * Packets are 188 bytes and begin with 0x47. The audio PID is found rather than
 * assumed — by looking for the packet whose payload opens a PES with an audio
 * stream_id (0xC0–0xDF) — because a stream that added a video or data track would
 * otherwise be concatenated into nonsense. Adaptation fields are skipped, PES
 * headers are stripped from the packets that start one, and what is left is the
 * audio exactly as the encoder wrote it.
 */
export function demuxAudio(bytes) {
  const start = bytes.indexOf(0x47);
  if (start < 0) return null;

  let audioPid = -1;
  const parts = [];
  let total = 0;

  for (let i = start; i + 188 <= bytes.length; i += 188) {
    const p = bytes.subarray(i, i + 188);
    if (p[0] !== 0x47) break;                       // lost alignment; trust nothing after
    const pid = ((p[1] & 0x1f) << 8) | p[2];
    const unitStart = (p[1] & 0x40) !== 0;
    const adaptation = (p[3] >> 4) & 0x03;
    if (adaptation === 0 || adaptation === 2) continue;   // no payload in this one
    let at = 4 + (adaptation === 3 ? 1 + p[4] : 0);
    if (at >= 188) continue;

    const isPes = unitStart && p[at] === 0 && p[at + 1] === 0 && p[at + 2] === 1;
    if (audioPid < 0) {
      if (!isPes || p[at + 3] < 0xc0 || p[at + 3] > 0xdf) continue;
      audioPid = pid;
    } else if (pid !== audioPid) {
      continue;
    }
    // A PES header is nine bytes plus whatever optional fields it declares.
    if (isPes) at += 9 + p[at + 8];
    if (at >= 188) continue;
    const chunk = p.subarray(at);
    parts.push(chunk);
    total += chunk.length;
  }

  if (!total) return null;
  const out = new Uint8Array(total);
  let w = 0;
  for (const c of parts) { out.set(c, w); w += c.length; }
  return out;
}

/** Segment names in playlist order, ignoring the directives. */
export const parsePlaylist = (text) => String(text)
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

/**
 * A hydrophone, presented as a stream like any other.
 *
 * Everything after "here are some decoded samples" is inherited: the scheduling,
 * the underrun accounting, the health check, the retry with backoff. Only the
 * fetching differs, because HLS is a playlist that has to be asked again rather
 * than a socket that keeps giving.
 */
export class HydrophoneStream extends DecodedStream {
  constructor(ctx, source, opts = {}) {
    super(ctx, source, { ...opts, chunkSeconds: 10 });
    this.pollMs = opts.pollMs ?? 6000;
    this.played = new Set();
    this.timer = null;
  }

  async connect() {
    this.tries++;
    this.setState('connecting');
    this.controller = new AbortController();

    const first = new Promise((resolve, reject) => { this.firstAudio = { resolve, reject }; });
    const timer = setTimeout(
      () => this.firstAudio?.reject(new Error('timed out waiting for audio')),
      this.readyTimeoutMs,
    );
    this.poll().catch((err) => {
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

  async poll() {
    const signal = this.controller.signal;
    const get = async (url) => {
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`${url.split('/').pop()} answered ${res.status}`);
      return res;
    };

    const stamp = (await (await get(`${this.source.url}/latest.txt`)).text()).trim();
    if (!/^\d+$/.test(stamp)) throw new Error('no current stream at this hydrophone');
    const base = `${this.source.url}/hls/${stamp}`;

    for (;;) {
      if (this.destroyed) return;
      const names = parsePlaylist(await (await get(`${base}/live.m3u8`)).text());
      // Only the newest, and only once. Working through the backlog would play
      // yesterday's tide at full speed and never catch up.
      const newest = names[names.length - 1];
      if (newest && !this.played.has(newest)) {
        this.played.add(newest);
        // The set is bounded: these playlists run to thousands of segments.
        if (this.played.size > 40) this.played.delete(this.played.values().next().value);
        await this.take(`${base}/${newest}`);
      }
      await new Promise((r) => { this.timer = setTimeout(r, this.pollMs); });
    }
  }

  /** One segment: fetch, unwrap the transport, decode, schedule. */
  async take(url) {
    const res = await fetch(url, { signal: this.controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`segment answered ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    this.bytesIn += bytes.length;
    this.lastBytesMs = performance.now();

    const es = demuxAudio(bytes);
    if (!es) { this.setState('stalled', 'a segment held no audio'); return; }
    let audio;
    try {
      audio = await this.ctx.decodeAudioData(es.slice().buffer);
    } catch (err) {
      this.setState('stalled', `a segment would not decode (${err.name || 'error'})`);
      return;
    }
    if (this.destroyed) return;
    // No prepended frame to drop: ADTS frames are self-contained, unlike MP3's
    // borrowing from its predecessors.
    this.schedule(audio, 0);
  }

  abort() {
    clearTimeout(this.timer);
    this.played.clear();
    super.abort();
  }
}
