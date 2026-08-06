// Finding the edges of MP3 frames in a stream that started without us.
//
// An Icecast mount hands you bytes from wherever the encoder happens to be — mid
// frame, no file header, no index. Chrome's decoder shrugs and finds the first sync
// word itself; WebKit's refuses the whole buffer with `EncodingError: Decoding
// failed`. Since iOS gives the Web Audio graph nothing but silence for a media
// element, decoding the bytes ourselves is the only way the piece can hear anything
// there at all — and that means handing the decoder a buffer that starts and ends
// exactly on a frame.
//
// Pure byte arithmetic, so it runs in the tests without a browser.

// Layer III only: this is what Icecast mounts serve, and supporting layers I and II
// would mean carrying two more bitrate tables for streams that do not exist.
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const RATES = {
  3: [44100, 48000, 32000, 0],   // MPEG 1
  2: [22050, 24000, 16000, 0],   // MPEG 2
  0: [11025, 12000, 8000, 0],    // MPEG 2.5
};

/**
 * Read a frame header at `at`, or null if there is not a valid one there.
 *
 * "Valid" is deliberately strict — every reserved value rejected — because a false
 * sync inside audio data is common and an aligned-to-nothing buffer decodes to
 * noise rather than failing honestly.
 */
export function readHeader(bytes, at = 0) {
  if (at + 4 > bytes.length) return null;
  const b0 = bytes[at], b1 = bytes[at + 1], b2 = bytes[at + 2], b3 = bytes[at + 3];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;   // 11 sync bits

  const versionBits = (b1 >> 3) & 0x03;                   // 01 is reserved
  if (versionBits === 1) return null;
  const layerBits = (b1 >> 1) & 0x03;
  if (layerBits !== 1) return null;                       // 01 = Layer III

  const bitrateIndex = (b2 >> 4) & 0x0f;
  if (bitrateIndex === 0 || bitrateIndex === 15) return null;  // free-form or invalid
  const rateIndex = (b2 >> 2) & 0x03;
  if (rateIndex === 3) return null;

  const mpeg1 = versionBits === 3;
  const bitrate = (mpeg1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] * 1000;
  const sampleRate = RATES[versionBits][rateIndex];
  if (!bitrate || !sampleRate) return null;

  const padding = (b2 >> 1) & 0x01;
  // 1152 samples per frame on MPEG 1, 576 on MPEG 2 and 2.5 — which is where the
  // 144 and 72 come from once divided by 8 bits per byte.
  const length = Math.floor((mpeg1 ? 144 : 72) * bitrate / sampleRate) + padding;
  if (length < 24) return null;

  return {
    length,
    bitrate,
    sampleRate,
    channels: ((b3 >> 6) & 0x03) === 3 ? 1 : 2,
    samples: mpeg1 ? 1152 : 576,
    version: mpeg1 ? 1 : (versionBits === 2 ? 2 : 2.5),
  };
}

/**
 * The offset of the first frame that is followed by `chain` more valid frames.
 *
 * One valid-looking header proves nothing: the bit pattern occurs inside ordinary
 * audio data often enough to matter. Frames that link up do prove it, because a
 * false sync almost never predicts where the next real one begins.
 */
export function findFirstFrame(bytes, { chain = 3, from = 0 } = {}) {
  for (let i = from; i < bytes.length - 4; i++) {
    if (bytes[i] !== 0xff) continue;
    let at = i;
    let ok = 0;
    for (let n = 0; n <= chain; n++) {
      const h = readHeader(bytes, at);
      if (!h) break;
      at += h.length;
      ok++;
      if (at + 4 > bytes.length) break;   // ran out of buffer, not out of frames
    }
    if (ok > chain || (ok > 0 && at >= bytes.length - 4)) return i;
  }
  return -1;
}

/**
 * The tail of an aligned buffer: its last `seconds` worth of whole frames.
 *
 * For the burst an Icecast mount sends on connect. That burst is not a head start,
 * it is the recent past — several seconds of already-happened audio, handed over so
 * a player can fill its buffer instantly. Playing all of it puts the place that far
 * behind the world, and since the burst is a different size on every mount, it puts
 * each place a *different* distance behind. In a piece about two places coinciding,
 * that is not latency, it is detuning.
 */
export function keepLastSeconds(aligned, seconds) {
  if (!aligned || aligned.seconds <= seconds) return aligned;
  const perFrame = aligned.samples / aligned.frames / aligned.sampleRate;
  const keep = Math.max(1, Math.ceil(seconds / perFrame));

  let at = 0;
  let skip = aligned.frames - keep;
  while (skip-- > 0) {
    const h = readHeader(aligned.data, at);
    if (!h) break;
    at += h.length;
  }
  const data = aligned.data.subarray(at);
  const frames = aligned.frames - (aligned.frames - keep);
  return {
    ...aligned,
    data,
    frames,
    samples: frames * (aligned.samples / aligned.frames),
    seconds: frames * perFrame,
    dropped: aligned.frames - frames,
  };
}

/**
 * Trim a mid-stream chunk to whole frames.
 *
 * Returns the aligned view plus what the frames say about themselves, or null if
 * there is not a single complete frame in there. The trailing partial frame is left
 * behind deliberately: `carry` is the tail the caller should prepend to the next
 * chunk, which is what makes continuous decoding possible without a gap or a click.
 */
export function alignToFrames(bytes) {
  const start = findFirstFrame(bytes);
  if (start < 0) return null;

  let at = start;
  let frames = 0;
  let samples = 0;
  let first = null;
  for (;;) {
    const h = readHeader(bytes, at);
    if (!h || at + h.length > bytes.length) break;
    first ??= h;
    at += h.length;
    frames++;
    samples += h.samples;
  }
  if (!frames) return null;

  return {
    data: bytes.subarray(start, at),
    carry: bytes.subarray(at),
    start,
    end: at,
    frames,
    samples,
    seconds: samples / first.sampleRate,
    sampleRate: first.sampleRate,
    channels: first.channels,
    bitrate: first.bitrate,
  };
}
