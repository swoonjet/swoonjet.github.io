// The lateral layer.
//
// Pattern matching says what a sound resembles. This says what two sounds might
// *mean* together. Tags from co-occurring events are related through a small
// hand-built graph of poetic adjacencies — shared ground, a bridge two steps
// away, or an outright opposition. That relation is what the piece composes on.

const EDGES = [
  // machinery and water keep collapsing into each other
  ['machine', 'current'], ['current', 'ocean'], ['ocean', 'weather'], ['ocean', 'sleep'],
  ['machine', 'corridor'], ['machine', 'sustain'], ['sustain', 'patience'],
  // weather is the great connector
  ['weather', 'wind'], ['weather', 'grain'], ['weather', 'many'], ['weather', 'open'],
  ['wind', 'distance'], ['distance', 'secret'], ['distance', 'flight'],
  // arrival, thresholds, intent
  ['arrival', 'threshold'], ['threshold', 'question'], ['question', 'answer'],
  ['approach', 'arrival'], ['approach', 'intent'], ['intent', 'effort'],
  ['corridor', 'threshold'], ['wood', 'forest'], ['hand', 'effort'],
  // time and waiting
  ['time', 'waiting'], ['waiting', 'patience'], ['patience', 'rhythm'],
  ['water', 'time'], ['water', 'cave'], ['cave', 'below'], ['below', 'dread'],
  // the living
  ['alive', 'human'], ['human', 'company'], ['company', 'warmth'], ['warmth', 'release'],
  ['release', 'break'], ['alive', 'small'], ['small', 'grain'], ['flight', 'morning'],
  ['morning', 'release'], ['forest', 'alive'], ['signal', 'meaning'], ['meaning', 'secret'],
  ['address', 'question'], ['meaning', 'answer'],
  // weight and surface
  ['mass', 'floor'], ['floor', 'below'], ['weight', 'mass'], ['friction', 'surface'],
  ['surface', 'glass'], ['glass', 'grain'], ['resistance', 'effort'], ['furniture', 'corridor'],
  ['erasure', 'sleep'], ['erasure', 'distance'], ['stranger', 'edge'], ['edge', 'threshold'],
  ['unknown', 'stranger'], ['unknown', 'secret'],
];

const OPPOSITES = [
  ['machine', 'alive'], ['dread', 'warmth'], ['arrival', 'erasure'],
  ['small', 'mass'], ['human', 'weather'], ['release', 'resistance'],
  ['sleep', 'intent'], ['signal', 'grain'], ['open', 'threshold'],
  ['meaning', 'unknown'], ['patience', 'break'],
];

const graph = new Map();
function link(a, b) {
  if (!graph.has(a)) graph.set(a, new Set());
  graph.get(a).add(b);
}
for (const [a, b] of EDGES) { link(a, b); link(b, a); }

const opposed = new Set(OPPOSITES.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

export function neighbours(tag) {
  return Array.from(graph.get(tag) ?? []);
}

export function areOpposed(a, b) {
  return opposed.has(`${a}|${b}`);
}

/**
 * Find the strongest relation between two tag sets.
 * kind: 'shared' (same tag) > 'contrast' (explicit opposition) >
 *       'bridge' (one hop) > 'far' (two hops) > 'none'.
 */
export function relate(tagsA, tagsB) {
  const setB = new Set(tagsB);

  const shared = tagsA.filter((t) => setB.has(t));
  if (shared.length) {
    return { kind: 'shared', tag: shared[0], via: shared[0], path: [shared[0]], strength: 1 };
  }

  for (const a of tagsA) {
    for (const b of tagsB) {
      if (areOpposed(a, b)) {
        return { kind: 'contrast', tag: a, other: b, path: [a, b], strength: 0.9 };
      }
    }
  }

  // One hop: a shared neighbour.
  for (const a of tagsA) {
    const na = graph.get(a);
    if (!na) continue;
    for (const b of tagsB) {
      if (na.has(b)) {
        return { kind: 'bridge', tag: b, via: b, path: [a, b], strength: 0.75 };
      }
      const nb = graph.get(b);
      if (!nb) continue;
      for (const mid of na) {
        if (nb.has(mid)) {
          return { kind: 'bridge', tag: mid, via: mid, path: [a, mid, b], strength: 0.6 };
        }
      }
    }
  }

  // Two hops, breadth-first from A's neighbourhood.
  for (const a of tagsA) {
    const seen = new Set([a]);
    let frontier = neighbours(a);
    for (let depth = 0; depth < 2; depth++) {
      const next = [];
      for (const node of frontier) {
        if (seen.has(node)) continue;
        seen.add(node);
        for (const b of tagsB) {
          const nb = graph.get(b);
          if (nb && nb.has(node)) {
            return { kind: 'far', tag: node, via: node, path: [a, node, b], strength: 0.42 };
          }
        }
        next.push(...neighbours(node));
      }
      frontier = next;
    }
  }

  return { kind: 'none', tag: null, path: [], strength: 0.15 };
}

/** All tags currently in play, weighted — the session's drifting subject matter. */
export class TagField {
  constructor(halfLifeMs = 42000) {
    this.halfLife = halfLifeMs;
    this.weights = new Map();
    this.lastMs = 0;
  }
  add(tags, timeMs, amount = 1) {
    this.decayTo(timeMs);
    for (const t of tags) this.weights.set(t, (this.weights.get(t) ?? 0) + amount);
  }
  decayTo(timeMs) {
    const dt = timeMs - this.lastMs;
    if (dt <= 0) return;
    this.lastMs = timeMs;
    const k = Math.pow(0.5, dt / this.halfLife);
    for (const [t, w] of this.weights) {
      const nw = w * k;
      if (nw < 0.02) this.weights.delete(t); else this.weights.set(t, nw);
    }
  }
  top(n = 5) {
    return [...this.weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
  }
}
