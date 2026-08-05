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
      // One source node per element, for the element's whole life.
      let node = null;
      try {
        node = ctx.createMediaElementSource(el);
      } catch {
        // Nothing to recycle without it; a stream will make its own element.
        continue;
      }
      this.entries.push({ el, node, leased: false });
    }
    this.primed = true;
    this.note = `${this.entries.length} elements unlocked`;
    return this;
  }

  /** An unlocked (element, node) pair, or null if the pool is empty or spent. */
  take() {
    const free = this.entries.find((e) => !e.leased);
    if (!free) return null;
    free.leased = true;
    return free;
  }

  /** Hand one back, silent and detached, ready for the next place. */
  give(entry) {
    if (!entry || !this.entries.includes(entry)) return false;
    try { entry.node.disconnect(); } catch { /* already gone */ }
    try {
      entry.el.pause();
      // Deliberately not removeAttribute('src'): an element with no source at all
      // is treated as a fresh one by some engines, and freshness is what we spent
      // the gesture to avoid. Park it back on the silence instead.
      entry.el.src = SILENCE;
      entry.el.load?.();
    } catch { /* fine */ }
    entry.leased = false;
    return true;
  }

  get available() {
    return this.entries.filter((e) => !e.leased).length;
  }
}
