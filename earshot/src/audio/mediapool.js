// Media elements, unlocked by the one gesture we are given.
//
// iOS will not load or play media it does not consider user-initiated, and
// "user-initiated" means *the same task as the tap* — not a second later, not
// after an await. It also ignores `preload`, so an element that has never been
// played in a gesture never fetches a byte.
//
// This piece cannot satisfy that naively, because at the moment of the tap it does
// not yet know which microphones exist: the soundmap has not been asked. So the tap
// primes a POOL of elements by playing a moment of silence through each, which is
// what unlocks them, and the streams are attached to those already-unlocked
// elements seconds later when the selection is finally known.
//
// Each entry keeps its own MediaElementAudioSourceNode for life. An element may be
// given exactly one of those, ever — a second call throws InvalidStateError — so
// recycling the PAIR is the only way to recycle an element at all.
//
// That node is created LATE, by `attach`, once the real stream URL is on the
// element — never here. This is the difference between hearing the piece and merely
// hearing the streams: WebKit does not reliably keep an element routed into the
// graph when its `src` changes after the node exists, and a broken route fails in
// the worst possible way. The element plays out of the speaker exactly as it should
// while every analyser reads nothing, so the piece sounds like four microphones and
// draws a frozen picture. That is what an iPhone showed. Priming costs nothing but a
// moment of silence; the routing is established once, on the stream it will carry.
//
// On a browser with no such policy this changes nothing: the elements are ordinary
// elements that happen to have been created early.

/** 8 kHz, mono, 8-bit, one silent sample. 45 bytes, and enough to count as playback. */
const SILENCE = 'data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA';

export class MediaPool {
  constructor() {
    this.entries = [];
    this.primed = false;
    this.note = 'not primed';
  }

  /**
   * Create and unlock `count` elements. MUST be called synchronously from the
   * gesture handler — after any await, iOS no longer counts it as user-initiated
   * and every element in the pool is as locked as one made later.
   */
  prime(ctx, count, makeAudio = () => new Audio()) {
    if (this.primed) return this;
    this.ctx = ctx;
    for (let i = 0; i < count; i++) {
      const el = makeAudio();
      el.crossOrigin = 'anonymous';   // must be set before any src, or media is tainted
      el.preload = 'auto';
      el.playsInline = true;
      el.loop = false;
      el.src = SILENCE;
      // The unlock itself. The rejection is expected on browsers that refuse and
      // uninteresting on the ones that do not — what matters is having asked
      // inside the gesture.
      const played = el.play?.();
      played?.catch?.(() => {});
      this.entries.push({ el, node: null, leased: false });
    }
    this.primed = true;
    this.note = `${this.entries.length} elements unlocked`;
    return this;
  }

  /**
   * An unlocked entry, or null if the pool is spent.
   *
   * Prefers one that has never carried a stream. An element that already has a
   * source node can only be re-pointed by changing its `src`, which is the very
   * thing that can sever the route into the graph — so spend the untouched ones
   * first and keep that risk for when there is nothing else left.
   */
  take() {
    const free = this.entries.find((e) => !e.leased && !e.node)
      ?? this.entries.find((e) => !e.leased);
    if (!free) return null;
    free.leased = true;
    return free;
  }

  /**
   * Route this element into the graph, once, now that it carries the stream it will
   * keep. Returns the node, or null if the element cannot be routed at all — in
   * which case the caller must not pretend it has been.
   */
  attach(entry, ctx = this.ctx) {
    if (entry.node) return entry.node;
    try {
      entry.node = ctx.createMediaElementSource(entry.el);
    } catch {
      entry.node = null;
    }
    return entry.node;
  }

  /**
   * Hand one back, stopped and detached, ready for the next place.
   *
   * The source is released rather than parked back on the silence. Parking would
   * gain nothing — the element is already unlocked, and nothing but a gesture can
   * change that — while costing another `src` change on an element that may now be
   * routed, which is the one operation this file exists to avoid. Releasing also
   * lets go of a socket to someone's Raspberry Pi.
   */
  give(entry) {
    if (!entry || !this.entries.includes(entry)) return false;
    try { entry.node?.disconnect(); } catch { /* already gone */ }
    try {
      entry.el.pause();
      entry.el.removeAttribute?.('src');
      entry.el.load?.();
    } catch { /* fine */ }
    entry.leased = false;
    return true;
  }

  get available() {
    return this.entries.filter((e) => !e.leased).length;
  }
}
