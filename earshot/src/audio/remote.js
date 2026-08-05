// One open microphone, held open.
//
// An Icecast stream from a solar-powered box in a wood is not a reliable thing.
// It stalls, it drops, the host goes away for an hour. This wraps one in
// something the rest of the piece can treat as a stable audio node: it
// reconnects with backoff, reports its state, and distinguishes a microphone
// that has stopped working from a microphone in a quiet place at night.

const STATES = ['connecting', 'live', 'stalled', 'failed'];

export class RemoteStream {
  constructor(ctx, source, { onState = () => {}, maxTries = 6, readyTimeoutMs = 12000 } = {}) {
    this.ctx = ctx;
    this.source = source;
    this.onState = onState;
    this.maxTries = maxTries;
    this.readyTimeoutMs = readyTimeoutMs;

    this.state = 'connecting';
    this.tries = 0;
    this.node = ctx.createGain();
    this.node.gain.value = 1;
    this.el = null;
    this.mediaNode = null;
    this.lastProgressMs = 0;
    this.liveSinceMs = 0;
    this.lastTime = -1;
    this.destroyed = false;
  }

  setState(state, detail = '') {
    if (this.destroyed || this.state === state) return;
    if (!STATES.includes(state)) return;
    this.state = state;
    this.onState(state, detail, this);
  }

  /** Open the stream and resolve once audio is genuinely flowing. */
  async connect() {
    this.tries++;
    this.setState('connecting');

    const el = new Audio();
    // crossOrigin must be set before src, or the media is tainted and every
    // analyser reading comes back as silence.
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.autoplay = false;
    el.loop = false;
    // Icecast ignores the query string; it defeats any intermediate cache.
    el.src = `${this.source.url}${this.source.url.includes('?') ? '&' : '?'}_=${this.tries}`;
    this.el = el;

    el.addEventListener('stalled', () => this.setState('stalled', 'stalled'));
    el.addEventListener('playing', () => {
      this.lastProgressMs = performance.now();
      this.setState('live');
    });

    const ready = new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new Error('could not open stream')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('timed out waiting for audio')); }, this.readyTimeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        el.removeEventListener('canplay', ok);
        el.removeEventListener('playing', ok);
        el.removeEventListener('error', bad);
      };
      el.addEventListener('canplay', ok, { once: true });
      el.addEventListener('playing', ok, { once: true });
      el.addEventListener('error', bad, { once: true });
    });

    // A MediaElementAudioSourceNode may only be created once per element, and
    // once created the element's output belongs to the graph.
    this.mediaNode = this.ctx.createMediaElementSource(el);
    this.mediaNode.connect(this.node);

    // Deliberately not awaited. A stream that opens a socket but never delivers
    // decodable audio leaves this promise pending forever, and awaiting it here
    // would hang past the timeout that is supposed to catch exactly that.
    el.play().catch(() => { /* `ready` decides whether this worked */ });
    await ready;

    // Only now arm the reconnect listeners. Attaching them before `ready`
    // resolves gives a failed first connection two owners — the rejection the
    // caller is waiting on, and a background retry it never asked for.
    el.addEventListener('error', () => this.retry('stream error'));
    el.addEventListener('ended', () => this.retry('stream ended'));

    this.lastProgressMs = performance.now();
    this.liveSinceMs = this.lastProgressMs;
    this.lastTime = el.currentTime;
    this.setState('live');
    return this;
  }

  /**
   * Health check, called from the run loop.
   *
   * The test is whether the element's clock is advancing — not whether there is
   * any sound. A field microphone in a wood at 3am is silent and perfectly
   * healthy; treating quiet as broken would throw away the best material in the
   * piece.
   */
  check(nowMs) {
    if (this.destroyed || !this.el) return this.state;

    // A hidden tab is not a broken stream. Browsers stop decoding media in
    // background tabs, so the clock legitimately freezes; judging it here would
    // burn through every reconnect attempt while the user was reading email.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      this.lastProgressMs = nowMs;
      return this.state;
    }

    const t = this.el.currentTime;
    if (t !== this.lastTime) {
      this.lastTime = t;
      this.lastProgressMs = nowMs;
      if (this.state !== 'live') this.setState('live');
      // A stream that has held up for a minute has earned its attempts back;
      // otherwise a long session dies of six unrelated blips hours apart.
      if (nowMs - this.liveSinceMs > 60000) { this.tries = 0; this.liveSinceMs = nowMs; }
      return this.state;
    }
    const idle = nowMs - this.lastProgressMs;
    if (idle > 12000) this.retry('clock stopped advancing');
    else if (idle > 5000) this.setState('stalled', 'no data');
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
    this.teardownElement();

    // Backoff, capped. These are someone's Raspberry Pi; do not hammer it.
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

  teardownElement() {
    try { this.mediaNode?.disconnect(); } catch { /* already gone */ }
    if (this.el) {
      this.el.pause();
      this.el.removeAttribute('src');
      try { this.el.load(); } catch { /* fine */ }
    }
    this.mediaNode = null;
    this.el = null;
  }

  destroy() {
    this.destroyed = true;
    this.teardownElement();
    try { this.node.disconnect(); } catch { /* already gone */ }
  }
}

/**
 * Open `want` working streams out of `candidates`, which arrive in best-spread
 * order.
 *
 * Concurrent within a round, and only as many rounds as needed: opening every
 * candidate at once and discarding the surplus would mean hammering a dozen
 * solar-powered field recorders to use four of them. Sequential rounds would
 * mean a boot as long as the sum of every timeout.
 */
export async function openStreams(ctx, candidates, want, { onNote = () => {}, onState = () => {} } = {}) {
  const opened = [];
  const tried = new Set();
  let round = 0;

  while (opened.length < want && round < 3) {
    const need = want - opened.length;
    const batch = candidates.filter((s) => !tried.has(s.id)).slice(0, need);
    if (!batch.length) break;
    batch.forEach((s) => tried.add(s.id));
    round++;

    onNote(round === 1
      ? `opening ${batch.length} streams — ${batch.map((s) => s.city).join(', ')}…`
      : `${need} short, trying ${batch.map((s) => s.city).join(', ')}…`);

    const results = await Promise.all(batch.map((source) => {
      const stream = new RemoteStream(ctx, source, {
        onState: (state, detail) => onState(source, state, detail, stream),
      });
      return stream.connect()
        .then(() => ({ ok: true, stream, source }))
        .catch((err) => { stream.destroy(); return { ok: false, source, err }; });
    }));

    for (const r of results) {
      if (r.ok) {
        opened.push(r.stream);
        onNote(`${r.source.place} is live`);
      } else {
        onNote(`${r.source.place} would not open — ${r.err.message}`);
      }
    }
  }
  return opened;
}
