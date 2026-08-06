import { clamp, lerp, rand, dist, approach } from './util.js';
import { consonance, snapToJust, centsToHz, MAJOR_THIRD, PERFECT_FIFTH } from './tuning.js';
import { Triangle, edgeMid, edgeNormal } from './triangle.js';
import { channelIndex } from './palette.js';
import { patchFor } from './patches.js';

const MAX_NODES = 42;
const MAX_LINK_DIST = 420;
const RESONANCE_R = 240;
const HOVER_R = 210;
const MAX_PULSES = 240;
const FIRE_GAP = 0.055;

let pulseSeed = 0;

class Connection {
  constructor(a, ai, b, bi, affinity) {
    this.a = a;
    this.ai = ai;
    this.b = b;
    this.bi = bi;
    this.affinity = affinity;
    this.progress = 0; // hyphal tip reaching across
    this.alive = false;
    this.strength = 0;
    this.usage = 0;
    this.strain = 0;
    this.seed = rand(1000);
    this.dead = false;
    // what the thread wants to be; the spring hauls toward it and `tension`
    // records how far past it the thread is being stretched
    this.rest = lerp(225, 150, affinity);
    this.tension = 0;
  }
  ends() {
    return [edgeMid(this.a, this.ai), edgeMid(this.b, this.bi)];
  }
  other(t) {
    return t === this.a ? { tri: this.b, edge: this.bi } : { tri: this.a, edge: this.ai };
  }
}

export class Network {
  constructor(engine) {
    this.engine = engine;
    this.tris = [];
    this.conns = [];
    this.pulses = [];
    this.time = 0;
    this.width = 1;
    this.height = 1;

    // The two extra axes.
    this.flow = 1; // fourth: metabolic rate of the whole network
    this.spirit = 0; // fifth: rooted (−1) ↔ ascendant (+1)
    this.spiritSmooth = 0;

    this.mouse = { x: -9999, y: -9999, vx: 0, vy: 0, inside: false };
    this.sweepX = 0;
    this.sweepY = 0;
    this.rewireClock = 0;
    this.refractory = new Map(); // pair key → time it may regrow
    this.touching = new Set(); // latched contacts, so an overlap strikes once
    this.rimRelease = [];
    this.sirenT = 0; // phase of the collective wail
    // Swirl: signed curl of the cursor's path. Stirring one way or the other
    // sets how each new note moves through the stereo field.
    this.swirlRaw = 0;
    this.frozen = false; // `f` holds the mycelium still; sound carries on
    // The drone is not a fixed backdrop — it is a readout of the stage. It rises
    // with the population and ducks under activity, like a sidechain.
    this.activity = 0;
    this.bedDuck = 1;
    this.bedFill = 0;
    this.lastPitches = [];
  }

  get gravityAngle() {
    // rooted points down-screen, ascendant points up, passing through the
    // horizontal on the way. Sweeping vertically rotates the whole field.
    return Math.PI / 2 - ((this.spirit + 1) / 2) * Math.PI;
  }

  env() {
    return {
      flow: this.flow,
      spirit: this.spirit,
      gravityAngle: this.gravityAngle,
      sirenT: this.sirenT,
      width: this.width,
      height: this.height,
    };
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
  }

  germinate(x, y, opts = {}) {
    if (this.tris.length >= MAX_NODES) {
      // the network makes room: the least-connected, quietest node gives way
      let victim = null;
      for (const t of this.tris) {
        if (t.dying > 0) continue;
        const score = t.liveConns * 2 + t.energy;
        if (!victim || score < victim._score) {
          victim = t;
          victim._score = score;
        }
      }
      if (victim) this.dissolve(victim);
      else return null;
    }
    const t = new Triangle(x, y, opts);
    t.z = clamp(opts.z ?? rand(0.35, -0.35), -1, 1);
    this.tris.push(t);
    return t;
  }

  dissolve(t) {
    if (t.dying > 0) return;
    t.dying = 0.001;
    for (const e of t.edges) if (e.conn) this.killConn(e.conn);
  }

  killConn(c) {
    if (c.dead) return;
    c.dead = true;
    c.alive = false;
    if (c.a.edges[c.ai].conn === c) c.a.edges[c.ai].conn = null;
    if (c.b.edges[c.bi].conn === c) c.b.edges[c.bi].conn = null;
    this.refractory.set(pairKey(c.a, c.b), this.time + rand(1.4, 0.5));
  }

  // ————— input-driven axes —————

  /** Feed one unit of path curl, −1..1 per sample of movement. */
  addSwirl(curl) {
    this.swirlRaw = clamp(this.swirlRaw + curl * 0.55, -3.2, 3.2);
  }

  /** What a note fired right now should do in the stereo field. */
  stereoNow() {
    const a = Math.abs(this.swirlRaw);
    return {
      swirl: clamp((a - 0.25) / 1.6, 0, 1),
      spin: this.swirlRaw >= 0 ? 1 : -1,
    };
  }

  setMouse(x, y, dx, dy, dt) {
    this.mouse.x = x;
    this.mouse.y = y;
    this.mouse.inside = true;
    if (dt > 0) {
      this.sweepX += dx;
      this.sweepY += dy;
    }
  }

  updateAxes(dt) {
    // sweep accumulators bleed away, so the axes drift home when you stop moving
    const bleed = Math.exp(-dt * 2.6);
    this.sweepX *= bleed;
    this.sweepY *= bleed;

    const flowTarget = clamp(Math.exp(this.sweepX / 165), 0.2, 3.1);
    this.flow = approach(this.flow, flowTarget, 0.32, dt);

    const spiritTarget = clamp(-this.sweepY / 130, -1, 1);
    this.spiritSmooth = approach(this.spiritSmooth, spiritTarget, 0.55, dt);

    // A very slow autonomous tide so an untouched network is never quite still.
    const tide = 0.2 * Math.sin(this.time * 0.041) + 0.09 * Math.sin(this.time * 0.0131 + 2);
    this.spirit = clamp(this.spiritSmooth * 0.82 + tide, -1, 1);
    this.engine.setSpirit(this.spirit);
  }

  // ————— simulation —————

  step(dt) {
    this.time += dt;
    // the wail runs a little faster when the network's metabolism is up
    this.sirenT += dt * (0.62 + this.flow * 0.3);

    // Activity is a leaky count of everything the colony has just played.
    // Ducking is fast to fall and slow to lift, so a busy passage pushes the
    // drone out of the way and it creeps back in as things settle.
    // swirl bleeds away quickly — it is a gesture, not a setting
    this.swirlRaw *= Math.exp(-dt * 1.15);

    this.activity *= Math.exp(-dt * 0.9);
    const act = clamp(this.activity / 6, 0, 1);
    const duckTarget = 1 - act * 0.82;
    this.bedDuck = approach(
      this.bedDuck,
      duckTarget,
      duckTarget < this.bedDuck ? 0.1 : 1.8,
      dt
    );
    // and it fills out as the colony grows: one voice alone, four when crowded
    this.bedFill = approach(this.bedFill, clamp((this.tris.length - 1) / 13, 0, 1), 2.5, dt);
    this.updateAxes(dt);
    const env = this.env();

    // hover attention: proximity makes a cluster shiver and listen
    if (this.mouse.inside) {
      for (const t of this.tris) {
        const d = dist(t.x, t.y, this.mouse.x, this.mouse.y);
        if (d < HOVER_R) {
          const a = 1 - d / HOVER_R;
          t.attention = Math.max(t.attention, a * a);
        }
      }
    }

    for (const t of this.tris) {
      const { changed, spontaneous } = t.update(dt, env);
      if (t.grow < 0.35) continue;
      if (changed && this.time - t.lastFire > FIRE_GAP) {
        // the active edge rotated into the field — a strike
        const strength = clamp(0.3 + Math.abs(t.omega) * 0.16, 0.28, 0.85);
        this.fire(t, t.activeEdge, strength, 0);
      } else if (spontaneous) {
        this.fire(t, t.activeEdge, rand(0.62, 0.34), 0);
      }
    }

    this.glide(env);
    this.selfTune(dt);
    this.physics(dt, env);
    if (!this.frozen) {
      this.rewire(dt);
      this.growConns(dt);
    }
    this.movePulses(dt);
    this.updateBed(dt);
    this.reap();
  }

  reap() {
    this.conns = this.conns.filter((c) => !c.dead);
    for (const t of this.tris) t.liveConns = 0;
    for (const c of this.conns) {
      if (c.alive) {
        c.a.liveConns++;
        c.b.liveConns++;
      }
    }
    this.tris = this.tris.filter((t) => t.dying < 1);
    if (this.refractory.size > 400) this.refractory.clear();

    // let rim latches go once the body has had time to bounce away
    if (this.rimRelease.length) {
      this.rimRelease = this.rimRelease.filter((r) => {
        if (r.at <= this.time) {
          this.touching.delete(r.key);
          return false;
        }
        return true;
      });
    }
  }

  // A note that is still ringing keeps following its triangle's rotation, so a
  // spun triangle glissandos instead of restriking.
  glide(env) {
    const now = this.engine.ready ? this.engine.ctx.currentTime : 0;
    for (const t of this.tris) {
      if (!t.voice) continue;
      if (t.voice.endTime <= now) {
        t.voice = null;
        continue;
      }
      // The wail, wanted and deliberate: a ringing note follows the live gravity
      // angle AND its own siren sweep, untapered. Notes land in tune with the
      // major drone and then wander off it — the drone is what keeps the whole
      // thing anchored instead of merely seasick.
      const abs =
        t.edgeCents(t.voiceEdge) +
        t.bendCents(env.gravityAngle) +
        (t.sirenCents(env.sirenT) - t.voiceSiren0);
      t.voice.bend(abs - t.voiceBase, 0.13);
    }
  }

  // Hovered triangles pull their edges toward just intervals against whatever
  // they are actually connected to. This is the microtonal layer with a mind.
  selfTune(dt) {
    for (const t of this.tris) {
      if (t.attention < 0.02) continue;
      for (let i = 0; i < 3; i++) {
        const e = t.edges[i];
        if (!e.conn || !e.conn.alive) continue;
        const o = e.conn.other(t);
        const mine = t.edgeCents(i);
        const theirs = o.tri.edgeCents(o.edge);
        const target = theirs + snapToJust(mine - theirs);
        const delta = target - mine;
        e.cents = clamp(e.cents + delta * t.attention * dt * 2.4, -95, 95);
      }
    }
  }

  physics(dt, env) {
    const spirit = env.spirit;

    for (const t of this.tris) {
      // walls sit clear of the body's own radius, and the bottom strip is
      // reserved so a settled colony never buries the readout
      const m = 46 + t.extent();
      const mBottom = m + 78;
      let ax = 0;
      let ay = 0;

      // Fifth axis: the whole colony seeks a band — low and settled when rooted,
      // high and floating when ascendant. A spring rather than a constant push,
      // so the extremes spread the network instead of piling it on a wall.
      // each body keeps its own place in the band so the mat has depth
      const band = this.height * (0.52 - spirit * 0.26) + t.zSeed * 150;
      ay += (band - t.y) * 0.55;

      // gentle repulsion so fruiting bodies do not overlap — and where they
      // arrive hard enough, a struck membrane
      for (const o of this.tris) {
        if (o === t) continue;
        const dx = t.x - o.x;
        const dy = t.y - o.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const minD = (t.extent() + o.extent()) * 0.85 + 18;
        if (d < minD) {
          // mass scales with reach, so a huge body shoves and is barely shoved
          const mine = t.extent();
          const theirs = o.extent();
          const give =
            clamp((theirs * theirs) / (mine * mine + theirs * theirs), 0.08, 0.92) * 2;
          const f = ((minD - d) / minD) * 220 * give;
          ax += (dx / d) * f;
          ay += (dy / d) * f;
          if (t.id < o.id) this.contact(t, o, dx / d, dy / d, d, minD);
        }
      }

      // soft walls, stiff enough that gravity cannot push a body off the dish.
      // A body driven into the rim thuds against it — the dead, damped version
      // of the collision drum.
      const K = 9;
      if (t.x < m) {
        ax += (m - t.x) * K;
        this.rimHit(t, -t.vx, 0);
      }
      if (t.x > this.width - m) {
        ax -= (t.x - (this.width - m)) * K;
        this.rimHit(t, t.vx, Math.PI);
      }
      if (t.y < m) {
        ay += (m - t.y) * K;
        this.rimHit(t, -t.vy, Math.PI / 2);
      }
      if (t.y > this.height - mBottom) {
        ay -= (t.y - (this.height - mBottom)) * K;
        this.rimHit(t, t.vy, -Math.PI / 2);
      }

      t.vx += ax * dt;
      t.vy += ay * dt;
    }

    // threads behave as springs — the network holds its own shape
    for (const c of this.conns) {
      if (!c.alive) continue;
      const dx = c.b.x - c.a.x;
      const dy = c.b.y - c.a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const rest = c.rest;
      c.tension = clamp(d / rest - 1, 0, 1.5);
      // sticky: a live thread hauls its partners in, and hauls harder the
      // further you drag them apart
      const f = (d - rest) * 1.8 * c.strength;
      const nx = (dx / d) * f;
      const ny = (dy / d) * f;
      c.a.vx += nx * dt;
      c.a.vy += ny * dt;
      c.b.vx -= nx * dt;
      c.b.vy -= ny * dt;
    }

    for (const t of this.tris) {
      if (t.held) {
        t.vx = 0;
        t.vy = 0;
        continue;
      }
      const damp = Math.exp(-dt * 1.9);
      t.vx *= damp;
      t.vy *= damp;
      t.x += t.vx * dt;
      t.y += t.vy * dt;

      // depth follows the axis too: ascendant clusters spread through z
      const zTarget = spirit > 0 ? t.zSeed * spirit * 0.8 : t.z * 0.35;
      t.z = clamp(approach(t.z, zTarget, 2.2, dt), -1, 1);
    }
  }

  // Which pair of edges on two triangles most nearly face each other?
  facingEdges(a, b) {
    const toB = Math.atan2(b.y - a.y, b.x - a.x);
    let ai = -1;
    let aBest = -Infinity;
    for (let i = 0; i < 3; i++) {
      if (a.edges[i].conn) continue;
      const s = Math.cos(edgeNormal(a, i) - toB);
      if (s > aBest) {
        aBest = s;
        ai = i;
      }
    }
    let bi = -1;
    let bBest = -Infinity;
    for (let i = 0; i < 3; i++) {
      if (b.edges[i].conn) continue;
      const s = Math.cos(edgeNormal(b, i) - (toB + Math.PI));
      if (s > bBest) {
        bBest = s;
        bi = i;
      }
    }
    if (ai < 0 || bi < 0) return null;
    return { ai, bi, facing: (aBest + bBest) / 2 };
  }

  rewire(dt) {
    this.rewireClock -= dt;
    if (this.rewireClock > 0) return;
    this.rewireClock = 0.16;

    for (let i = 0; i < this.tris.length; i++) {
      const a = this.tris[i];
      if (a.grow < 0.6 || a.dying > 0) continue;
      for (let j = i + 1; j < this.tris.length; j++) {
        const b = this.tris[j];
        if (b.grow < 0.6 || b.dying > 0) continue;
        const key = pairKey(a, b);
        if (this.refractory.get(key) > this.time) continue;
        if (this.hasConn(a, b)) continue;
        const d = dist(a.x, a.y, b.x, b.y);
        if (d > MAX_LINK_DIST) continue;
        const pick = this.facingEdges(a, b);
        if (!pick || pick.facing < -0.3) continue;
        const cons = consonance(a.edgeCents(pick.ai), b.edgeCents(pick.bi));
        // Consonant, well-aimed, nearby pairs are the ones the mycelium invests in.
        const affinity = cons * (1 - d / MAX_LINK_DIST) * (0.45 + pick.facing * 0.55);
        if (affinity < 0.05) continue;
        const c = new Connection(a, pick.ai, b, pick.bi, affinity);
        a.edges[pick.ai].conn = c;
        b.edges[pick.bi].conn = c;
        this.conns.push(c);
      }
    }
  }

  hasConn(a, b) {
    for (const e of a.edges) {
      if (e.conn && (e.conn.a === b || e.conn.b === b)) return true;
    }
    return false;
  }

  growConns(dt) {
    for (const c of this.conns) {
      if (c.dead) continue;
      if (c.a.dying > 0 || c.b.dying > 0) {
        this.killConn(c);
        continue;
      }

      const [pa, pb] = c.ends();
      const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const toB = Math.atan2(c.b.y - c.a.y, c.b.x - c.a.x);
      const fa = Math.cos(edgeNormal(c.a, c.ai) - toB);
      const fb = Math.cos(edgeNormal(c.b, c.bi) - (toB + Math.PI));
      // strain: rotate a triangle away and its threads tear
      c.strain = clamp(1 - (fa + fb) / 2, 0, 2);

      if (!c.alive) {
        c.progress += dt * this.flow * (0.38 + c.affinity * 1.0);
        if (d > MAX_LINK_DIST * 1.5 || c.strain > 1.45) {
          this.killConn(c);
          continue;
        }
        if (c.progress >= 1) {
          c.alive = true;
          c.strength = 0.06;
        }
        continue;
      }

      // A strained thread re-roots onto a better-aimed edge before it gives up —
      // mycelium abandons a route, it does not snap like a cable.
      if (c.strain > 0.5 && this.reroot(c, toB)) c.strain = 0.2;

      c.usage *= Math.exp(-dt * 0.55);
      const gain = 0.52 * c.affinity + 0.5 * Math.min(1, c.usage);
      // sticky: almost no idle rot, forgiving of strain, and it will stretch
      // half again past its reach before it begins to suffer at all
      const loss =
        0.022 + c.strain * 0.1 + Math.max(0, d - MAX_LINK_DIST * 1.35) * 0.006;
      c.strength = clamp(c.strength + (gain - loss) * dt * this.flow, 0, 1);
      if (c.strength <= 0.015) this.killConn(c);
    }
  }

  /**
   * Two bodies are overlapping. If they are still closing, and closing fast
   * enough, strike a membrane. The pair is latched until it separates so a
   * resting overlap cannot machine-gun.
   */
  contact(a, b, nx, ny, d, minD) {
    const key = pairKey(a, b);
    // closing speed along the contact normal (normal points a ← b)
    const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (closing < 34) {
      if (d > minD * 0.995) this.touching.delete(key);
      return;
    }
    if (this.touching.has(key)) return;
    this.touching.add(key);

    const amp = clamp((closing - 34) / 520, 0.06, 1);
    const size = a.extent() + b.extent();
    const hz = clamp(5400 / Math.max(24, size), 38, 210);
    const u = (this.spirit + 1) / 2;

    this.engine.drum({
      hz,
      amp: amp * 0.85,
      // rooted collisions are dead thuds, ascendant ones ring like a frame drum
      decay: lerp(0.26, 0.52, u) * rand(1.2, 0.85),
      tone: clamp(lerp(0.32, 0.85, u) + amp * 0.3, 0.15, 1.2),
      pan: clamp(((a.x + b.x) / 2 / this.width) * 2 - 1, -1, 1) * 0.8,
      depth: (a.z + b.z) / 2,
    });

    const ang = Math.atan2(ny, nx);
    a.impact = Math.min(1.15, a.impact + amp);
    a.impactAngle = ang + Math.PI;
    b.impact = Math.min(1.15, b.impact + amp);
    b.impactAngle = ang;
    // a real knock shakes some charge loose and works the body a little
    a.nutrient = Math.min(a.threshold, a.nutrient + amp * 0.3);
    b.nutrient = Math.min(b.threshold, b.nutrient + amp * 0.3);
    a.strikeRate += amp * 0.5;
    b.strikeRate += amp * 0.5;
  }

  /** A body driven into the rim of the dish. Lower, deader, no skin. */
  rimHit(t, speed, angle) {
    if (speed < 60) return;
    const key = 'rim' + t.id + Math.round(angle * 10);
    if (this.touching.has(key)) return;
    this.touching.add(key);
    const amp = clamp((speed - 60) / 620, 0.05, 0.8);
    this.engine.drum({
      hz: clamp(3400 / Math.max(24, t.extent() * 2), 30, 130),
      amp: amp * 0.7,
      decay: 0.2 * rand(1.2, 0.85),
      tone: 0.2,
      pan: clamp((t.x / this.width) * 2 - 1, -1, 1) * 0.8,
      depth: t.z,
    });
    t.impact = Math.min(1.15, t.impact + amp);
    t.impactAngle = angle;
    t.strikeRate += amp * 0.4;
    // release the latch shortly after, once the body is heading away
    this.rimRelease.push({ key, at: this.time + 0.22 });
  }

  // Move one end of a thread to a free edge that aims better at its partner.
  reroot(c, toB) {
    let moved = false;
    const ends = [
      { tri: c.a, key: 'ai', aim: toB },
      { tri: c.b, key: 'bi', aim: toB + Math.PI },
    ];
    for (const end of ends) {
      const cur = c[end.key];
      const curFacing = Math.cos(edgeNormal(end.tri, cur) - end.aim);
      let best = -1;
      let bestFacing = curFacing + 0.18; // grab at any real improvement
      for (let i = 0; i < 3; i++) {
        if (i === cur || end.tri.edges[i].conn) continue;
        const f = Math.cos(edgeNormal(end.tri, i) - end.aim);
        if (f > bestFacing) {
          bestFacing = f;
          best = i;
        }
      }
      if (best < 0) continue;
      end.tri.edges[cur].conn = null;
      end.tri.edges[best].conn = c;
      c[end.key] = best;
      moved = true;
    }
    if (moved) {
      c.affinity = clamp(
        consonance(c.a.edgeCents(c.ai), c.b.edgeCents(c.bi)) *
          (1 - dist(c.a.x, c.a.y, c.b.x, c.b.y) / MAX_LINK_DIST),
        0.05,
        1
      );
    }
    return moved;
  }

  movePulses(dt) {
    const keep = [];
    for (const p of this.pulses) {
      const c = p.conn;
      if (c.dead || !c.alive) continue;
      const [pa, pb] = c.ends();
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
      // conduction speed rides the time axis and the thread's own health
      const speed = this.flow * (60 + c.strength * 190);
      p.pos += (speed * dt) / len;
      if (p.pos >= 1) {
        const target = p.dir > 0 ? { tri: c.b, edge: c.bi } : { tri: c.a, edge: c.ai };
        c.usage = Math.min(2, c.usage + 0.6);
        this.fire(target.tri, target.edge, p.amp, p.hops + 1);
        continue;
      }
      keep.push(p);
    }
    this.pulses = keep;
  }

  /**
   * Sound one edge, then push the event outward along the mycelium.
   * hops guards against a cycle feeding itself forever.
   */
  fire(t, edgeIndex, amp, hops) {
    if (!t || t.dying > 0 || t.grow < 0.3) return;
    if (this.time - t.lastFire < FIRE_GAP && hops > 0) return;
    t.lastFire = this.time;

    const env = this.env();
    const e = t.edges[edgeIndex];
    const cents = t.edgeCents(edgeIndex) + t.bendCents(env.gravityAngle);
    const hz = centsToHz(cents);
    const u = (env.spirit + 1) / 2;

    e.energy = Math.min(1.4, e.energy + amp);
    t.energy = Math.min(1.3, t.energy + amp * 0.85);
    t.strikeRate += amp;
    this.activity += amp;

    const patch = this.comboPatch(t, edgeIndex);
    const pan = clamp((t.x / this.width) * 2 - 1, -1, 1) * 0.8 + t.z * 0.15;

    // A body with no charge left cannot ring — a pulse arriving on it thuds
    // instead. This is where the drums enter the colony's own playing, so a
    // cascade through a depleted cluster comes out as a rhythm.
    if (hops > 0 && t.nutrient / t.threshold < 0.3) {
      this.engine.drum({
        hz: clamp(hz * 0.25, 34, 190),
        amp: amp * 0.6,
        decay: lerp(0.3, 0.18, u),
        tone: 0.35,
        pan,
        depth: t.z,
      });
    } else {
      // mono per body: a new strike retriggers rather than stacking
      const now = this.engine.ready ? this.engine.ctx.currentTime : 0;
      if (t.voice && t.voice.endTime > now && amp >= t.voice.amp * 0.6) {
        t.voice.cut();
        t.voice = null;
      }

      const voice = this.engine.strike({
        hz,
        amp: amp * 0.5,
        // rooted rings long, ascendant is shorter
        decay: patch.decay * lerp(1.5, 0.85, u) * rand(1.15, 0.85) /
          clamp(this.flow, 0.6, 2.0),
        ...patch,
        // the body's geometry moves the character within its family
        shape: t.shape(),
        stereo: this.stereoNow(),
        cutoff: (patch.cutoff ?? 5) * lerp(0.8, 1.25, u),
        temper: t.temper,
        pan,
        depth: t.z,
        // a harder hit uses a harder mallet
        attack: (patch.attack ?? 0.012) * lerp(1.6, 0.75, clamp(amp * 1.4, 0, 1)),
      });

      if (voice) {
        t.voice = voice;
        t.voiceEdge = edgeIndex;
        t.voiceBase = cents;
        t.voiceGravity = env.gravityAngle;
        t.voiceSiren0 = t.sirenCents(env.sirenT);
      }
    }

    // sympathetic resonance in the neighbourhood (never chains)
    if (hops === 0 && amp > 0.25) {
      for (const o of this.tris) {
        if (o === t || o.dying > 0 || o.grow < 0.5) continue;
        const d = dist(t.x, t.y, o.x, o.y);
        if (d > RESONANCE_R) continue;
        const oi = o.activeEdge;
        const cons = consonance(cents, o.edgeCents(oi));
        const ramp = amp * 0.34 * (1 - d / RESONANCE_R) * cons;
        if (ramp < 0.055) continue;
        o.edges[oi].energy = Math.min(1.2, o.edges[oi].energy + ramp * 0.8);
        o.energy = Math.min(1.2, o.energy + ramp * 0.4);
        const op = this.comboPatch(o, oi);
        this.engine.strike({
          hz: centsToHz(o.edgeCents(oi) + o.bendCents(env.gravityAngle)),
          amp: ramp * 0.42,
          decay: op.decay * lerp(1.7, 1.0, u),
          ...op,
          shape: o.shape(),
          stereo: this.stereoNow(),
          // a sympathetic body is not struck: no mallet, no dip
          wood: (op.wood ?? 0.35) * 0.2,
          donk: 1 + ((op.donk ?? 1.1) - 1) * 0.3,
          cutoff: (op.cutoff ?? 5) * 0.7,
          pan: clamp((o.x / this.width) * 2 - 1, -1, 1) * 0.8,
          depth: o.z,
          attack: 0.045,
          temper: o.temper,
        });
      }
    }

    // propagate along every healthy thread on this triangle
    if (hops >= 6 || this.pulses.length >= MAX_PULSES) return;
    // Gather the healthy threads, take the strongest few, and split the signal
    // between them. Without the 1/sqrt(n) split, a stickier and denser mesh
    // turns a single strike into a runaway branching cascade.
    const outs = [];
    for (let i = 0; i < 3; i++) {
      const c = t.edges[i].conn;
      if (c && c.alive && c.strength >= 0.16) outs.push(c);
    }
    if (!outs.length) return;
    outs.sort((a, b) => b.strength - a.strength);
    const take = outs.slice(0, 3);
    const split = 1 / Math.sqrt(take.length);
    for (const c of take) {
      const next = amp * (0.34 + c.strength * 0.3) * split;
      if (next < 0.09) continue;
      this.pulses.push({
        conn: c,
        dir: c.a === t ? 1 : -1,
        pos: 0,
        amp: next,
        hops,
        seed: pulseSeed++,
      });
    }
  }

  /**
   * Which colour pair is this edge sounding in? Its own channel, paired with
   * whatever it is joined to — or its nearest neighbour's active edge if it is
   * joined to nothing. Rewire the colony and its voices change.
   */
  comboPatch(t, edgeIndex) {
    const mine = channelIndex(t.edgeCents(edgeIndex));
    let other = mine;
    const c = t.edges[edgeIndex].conn;
    if (c && c.alive) {
      const o = c.other(t);
      other = channelIndex(o.tri.edgeCents(o.edge));
    } else {
      let near = null;
      let nd = RESONANCE_R;
      for (const o of this.tris) {
        if (o === t || o.dying > 0 || o.grow < 0.4) continue;
        const d = dist(t.x, t.y, o.x, o.y);
        if (d < nd) {
          nd = d;
          near = o;
        }
      }
      if (near) other = channelIndex(near.edgeCents(near.activeEdge));
    }
    // a body pulled out to huge speaks with one of the large voices instead
    const patch = patchFor(mine, other, t.isHuge());
    t.combo = patch.name;
    t.comboCh = [mine, other];
    return patch;
  }

  // Track the network's most reinforced pitches and let the bed sing them.
  updateBed(dt) {
    this._bedClock = (this._bedClock ?? 0) - dt;
    if (this._bedClock > 0) return;
    this._bedClock = 0.4;

    const weights = new Map();
    for (const c of this.conns) {
      if (!c.alive) continue;
      for (const [t, i] of [
        [c.a, c.ai],
        [c.b, c.bi],
      ]) {
        const cents = Math.round(t.edgeCents(i));
        weights.set(cents, (weights.get(cents) || 0) + c.strength);
      }
    }
    // With no threads there are no weights and the drone would fall silent —
    // wrong, since a lone triangle on the stage should still ground a root. Fall
    // back to the bodies' own active edges.
    if (!weights.size) {
      for (const t of this.tris) {
        if (t.dying > 0 || t.grow < 0.4) continue;
        const k = Math.round(t.edgeCents(t.activeEdge));
        weights.set(k, (weights.get(k) || 0) + 0.4 + t.energy);
      }
    }

    const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];

    // One key, held. Hysteresis on the root only — the drone's job is to stay
    // put and give the wailing voices something to be in tune against, so it
    // must not chase a churning network.
    if (top) {
      const cur = this.bedRoot;
      if (!cur) {
        this.bedRoot = { cents: top[0], since: this.time };
      } else {
        const incumbent = weights.get(cur.cents) ?? 0;
        if (top[0] !== cur.cents && this.time - cur.since > 6 && top[1] > incumbent * 1.6 + 0.2) {
          this.bedRoot = { cents: top[0], since: this.time };
        }
      }
    }
    if (!this.bedRoot) {
      this.engine.setBed([0, 0, 0, 0], 0);
      return;
    }

    // A plain major triad in just ratios, octave-folded into the low register.
    // How MUCH of it sounds is the stage's business: a lone triangle gets the
    // root only, a crowded colony gets the whole chord.
    const base = foldOctaves(centsToHz(this.bedRoot.cents), 44, 88);
    const chord = [base, base * PERFECT_FIFTH, base * MAJOR_THIRD * 2, base * 2];
    const slots = 1 + Math.round(this.bedFill * 3);
    const freqs = chord.map((f, i) => (i < slots ? f : 0));
    this.bedVoices = slots;
    this.lastPitches = [this.bedRoot.cents];
    const u = (this.spirit + 1) / 2;
    // Level: rises with the population, ducked by whatever is being played.
    const level = lerp(0.1, 0.34, this.bedFill) * lerp(0.85, 1.15, u) * this.bedDuck;
    this.bedLevel = level;
    this.engine.setBed(freqs, level);
  }

  liveConnCount() {
    return this.conns.reduce((n, c) => n + (c.alive ? 1 : 0), 0);
  }
}

/** Halve or double until the frequency sits inside [lo, hi]. */
function foldOctaves(hz, lo, hi) {
  let f = hz;
  let guard = 0;
  while (f > hi && guard++ < 12) f /= 2;
  while (f < lo && guard++ < 24) f *= 2;
  return f;
}

function pairKey(a, b) {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}
