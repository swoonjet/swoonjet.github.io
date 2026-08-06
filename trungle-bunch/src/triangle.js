import { TAU, clamp, lerp, rand, angleDelta, approach } from './util.js';
import { SCALE, centsToHz } from './tuning.js';

// How far a ringing note wanders as the colony wails, in cents.
export const SIREN_DEPTH = 330;

let nextId = 1;

// A body is no longer equilateral: each corner carries its own radius and
// angular offset, so corners can be dragged and the shape becomes a control.
// Geometry is cached in LOCAL space (offsets from the centre) and rebuilt only
// when theta, size or a corner changes — position may move freely without
// invalidating it.
export const VR_MIN = 0.42;
export const VR_MAX = 1.8;
export const VA_MAX = 0.7; // radians a corner may swing from its nominal third

export function nominalAngle(i) {
  return (i * TAU) / 3 - Math.PI / 2;
}

export function vertices(t) {
  return t.local.map((v) => ({ x: t.x + v.dx, y: t.y + v.dy }));
}

export function edgeMid(t, i) {
  const a = t.local[i];
  const b = t.local[(i + 1) % 3];
  return { x: t.x + (a.dx + b.dx) / 2, y: t.y + (a.dy + b.dy) / 2 };
}

/** Outward normal of the real edge, flipped to point away from the centre. */
export function edgeNormal(t, i) {
  const a = t.local[i];
  const b = t.local[(i + 1) % 3];
  const ex = b.dx - a.dx;
  const ey = b.dy - a.dy;
  let nx = ey;
  let ny = -ex;
  if (nx * (a.dx + b.dx) + ny * (a.dy + b.dy) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return Math.atan2(ny, nx);
}

export function vertexAngle(t, i) {
  return t.theta + nominalAngle(i) + t.va[i];
}

export class Triangle {
  constructor(x, y, opts = {}) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.z = opts.z ?? rand(0.3, -0.3);
    this.zSeed = rand(1, -1);
    this.baseR = opts.r ?? rand(52, 38);
    this.theta = rand(TAU);
    this.omega = rand(0.5, -0.5);
    // per-corner radius and angular offset — the shape, and a sound control
    this.vr = [1, 1, 1];
    this.va = [0, 0, 0];
    this.local = [
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ];
    this.seed = rand(1000);
    this.sirenSeed = rand(1); // offsets this body's wail so the colony is a chorus

    // grow from a spore
    this.grow = opts.grown ? 1 : 0;
    this.dying = 0;

    // Three edges, each a tuned voice of its own. Degrees are drawn from the
    // just scale with a spread wide enough that one triangle is already a chord.
    const root = (Math.random() * SCALE.length) | 0;
    const steps = [0, 2, 4];
    if (Math.random() < 0.4) steps[2] = 3;
    if (Math.random() < 0.3) steps[1] = 1;
    this.edges = steps.map((s, i) => ({
      index: i,
      degree: (root + s) % SCALE.length,
      octave: Math.floor((root + s) / SCALE.length) + (i === 0 ? 0 : Math.random() < 0.35 ? 1 : 0),
      cents: 0, // microtonal nudge, ±95
      energy: 0,
      conn: null,
      shimmer: rand(1),
    }));

    this.activeEdge = 0;
    this.energy = 0;
    this.nutrient = rand(0.5);
    this.threshold = rand(1.7, 0.8);
    this.metabolism = rand(1.35, 0.6);
    this.attention = 0;
    this.lastFire = -99;
    this.voice = null;
    this.voiceEdge = 0;
    this.voiceBase = 0;
    this.voiceGravity = 0;
    this.voiceSiren0 = 0;
    this.combo = 'flare';
    this.comboCh = [0, 0];
    this.liveConns = 0;
    this.octaveSmooth = 0;
    this.octaveBias = 0;
    this.held = false;
    this.bow = [rand(1, -1), rand(1, -1), rand(1, -1)]; // per-edge slack

    // Temper: how hard this body has been worked. Driven up by strike density,
    // relaxes when left alone. Morphs its bell from triangle wave toward square,
    // and straightens its bowed edges as it hardens.
    this.temper = 0;
    this.strikeRate = 0;

    // Impact from a collision — magnitude, and the direction it came from.
    this.impact = 0;
    this.impactAngle = 0;

    this.recomputeLocal();
  }

  radius() {
    const g = this.grow * (1 - this.dying);
    return this.baseR * g;
  }

  /** Rebuild the local vertex cache. Cheap, and only theta/size/corners dirty it. */
  recomputeLocal() {
    const r = this.radius();
    for (let i = 0; i < 3; i++) {
      const a = this.theta + nominalAngle(i) + this.va[i];
      const rr = r * this.vr[i];
      this.local[i].dx = Math.cos(a) * rr;
      this.local[i].dy = Math.sin(a) * rr;
    }
  }

  /**
   * Shape descriptors, 0..1, that the voice library reads. Deliberately NOT
   * mapped to pitch — the colony has to stay in tune with the major drone, so
   * shape moves timbre, decay and noise instead.
   */
  shape() {
    const [a, b, c] = this.vr;
    const mean = (a + b + c) / 3;
    const dev = (Math.abs(a - mean) + Math.abs(b - mean) + Math.abs(c - mean)) / 3;
    const angDev = (Math.abs(this.va[0]) + Math.abs(this.va[1]) + Math.abs(this.va[2])) / 3;
    return {
      // squat and broad → long and dark; small and tight → short and bright
      size: clamp((mean - VR_MIN) / (VR_MAX - VR_MIN), 0, 1),
      // how far from equilateral: drives noise, inharmonicity and detune spread
      skew: clamp((dev / 0.42) * 0.6 + (angDev / VA_MAX) * 0.4, 0, 1),
      // one corner pulled out far: thin and bright
      spike: clamp((Math.max(a, b, c) / mean - 1) / 0.65, 0, 1),
    };
  }

  /** Drag a corner: set its radius and swing from a point in world space. */
  setCorner(i, px, py) {
    const r = Math.max(1, this.radius());
    const dx = px - this.x;
    const dy = py - this.y;
    this.vr[i] = clamp(Math.hypot(dx, dy) / r, VR_MIN, VR_MAX);
    const nominal = this.theta + nominalAngle(i);
    this.va[i] = clamp(angleDelta(Math.atan2(dy, dx), nominal), -VA_MAX, VA_MAX);
    this.recomputeLocal();
  }

  nearestVertex(px, py) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < 3; i++) {
      const v = this.local[i];
      const d = Math.hypot(px - (this.x + v.dx), py - (this.y + v.dy));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, d: bestD };
  }

  scale() {
    return 1 + this.z * 0.32;
  }

  // Absolute pitch of an edge in cents above the root, before performance bend.
  edgeCents(i) {
    const e = this.edges[i];
    return SCALE[e.degree] + 1200 * (e.octave + this.octaveBias) + e.cents;
  }

  // Rotation is the expression control: angular velocity is a wide bend, and
  // position within the current 120° sector is a fine one.
  /**
   * The strike pitch. Deliberately siren-free: a note has to LAND in tune with
   * the major drone, and only then start to wander (see sirenCents).
   */
  bendCents(gravityAngle) {
    const spin = clamp(this.omega * 130, -800, 800);
    const d = angleDelta(this.theta - gravityAngle, 0);
    const sector = TAU / 3;
    let phase = ((d % sector) + sector) % sector;
    phase = phase / sector - 0.5;
    return spin + phase * 64;
  }

  /**
   * The wail. A slow deep sweep applied only to notes already sounding, each
   * body phase-offset so the colony wails as a chorus rather than in lockstep.
   */
  sirenCents(sirenT) {
    return (
      Math.sin(sirenT + this.sirenSeed * TAU) * SIREN_DEPTH +
      Math.sin(sirenT * 0.41 + this.sirenSeed * 11) * SIREN_DEPTH * 0.35
    );
  }

  edgeHz(i, gravityAngle) {
    return centsToHz(this.edgeCents(i) + this.bendCents(gravityAngle));
  }

  activeEdgeFor(gravityAngle) {
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < 3; i++) {
      const d = Math.cos(edgeNormal(this, i) - gravityAngle);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    return best;
  }

  update(dt, env) {
    this.theta += this.omega * dt;
    this.recomputeLocal();
    // ascendant states let a spin run on; grounded ones brake it
    const damp = lerp(1.15, 0.22, (env.spirit + 1) / 2);
    this.omega *= Math.exp(-dt * damp);

    if (this.grow < 1) this.grow = Math.min(1, this.grow + dt / 1.3);
    if (this.dying > 0) this.dying = Math.min(1, this.dying + dt / 0.8);

    this.energy *= Math.exp(-dt * 2.1);
    for (const e of this.edges) e.energy *= Math.exp(-dt * 3.0);
    this.attention *= Math.exp(-dt * 3.5);
    this.impact *= Math.exp(-dt * 2.6);

    // strikeRate is a leaky count of recent hits; sustained playing tempers the
    // body, and quiet lets it soften again over roughly ten seconds
    this.strikeRate *= Math.exp(-dt * 0.55);
    const want = clamp(this.strikeRate / 5, 0, 1);
    this.temper = approach(this.temper, want, want > this.temper ? 1.1 : 4.5, dt);

    // Register follows height on screen, so lifting a triangle lifts its voice.
    // Smoothed continuously but sounded in whole octaves — otherwise nothing in
    // the colony is ever in tune with anything else.
    const target = clamp((0.52 - this.y / env.height) * 3.2, -1, 2);
    this.octaveSmooth = lerp(this.octaveSmooth, target, 1 - Math.exp(-dt * 1.1));
    this.octaveBias = Math.round(this.octaveSmooth);

    const ae = this.activeEdgeFor(env.gravityAngle);
    const changed = ae !== this.activeEdge;
    this.activeEdge = ae;

    // Nutrient accrues faster in a well-connected node — hubs pulse, isolates wait.
    this.nutrient +=
      dt * env.flow * this.metabolism * (0.062 + 0.028 * this.liveConns) * this.grow;

    let spontaneous = false;
    if (this.nutrient >= this.threshold) {
      this.nutrient = 0;
      this.threshold = rand(1.9, 0.8);
      spontaneous = true;
    }
    return { changed, spontaneous };
  }

  contains(px, py) {
    // a deformed body can reach much further on one corner than another
    const s = this.scale();
    const d = Math.hypot(px - this.x, py - this.y);
    if (d > this.radius() * s * VR_MAX) return false;
    const a = Math.atan2(py - this.y, px - this.x);
    // radius of the outline in this direction, from the two nearest corners
    let best = 0;
    for (let i = 0; i < 3; i++) {
      const v = this.local[i];
      const va2 = Math.atan2(v.dy, v.dx);
      const w = Math.max(0, Math.cos(angleDelta(a, va2)));
      best = Math.max(best, Math.hypot(v.dx, v.dy) * (0.55 + 0.45 * w));
    }
    return d < best * s * 0.95;
  }

  /** The edge whose outward normal most nearly faces a given direction. */
  nearestEdgeToAngle(angle) {
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < 3; i++) {
      const d = Math.cos(edgeNormal(this, i) - angle);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    return best;
  }

  nearestEdge(px, py) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < 3; i++) {
      const m = edgeMid(this, i);
      const d = Math.hypot(px - m.x, py - m.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, d: bestD };
  }
}
