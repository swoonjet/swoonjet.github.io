import { clamp, angleDelta, dist } from './util.js';

const TAP_PX = 7;
const TAP_MS = 320;
const EDGE_HOT = 36;
const CORNER_HOT = 26;

/**
 * Gesture layer. There are no controls — only a hand moving through the field.
 * `shell` exposes { titleUp(), dismiss(x, y) }: while the title is up every
 * gesture is swallowed and simply returns you to the instrument.
 */
export function attachInput(canvas, net, shell) {
  const grab = {
    active: false,
    mode: null, // 'move' | 'spin' | 'sweep'
    tri: null,
    offx: 0,
    offy: 0,
    prevAngle: 0,
    corner: 0,
    downX: 0,
    downY: 0,
    downT: 0,
    travel: 0,
  };
  let last = { x: 0, y: 0, t: performance.now() };

  const pos = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  const hitTriangle = (x, y) => {
    // topmost (nearest in z) wins
    let best = null;
    for (const t of net.tris) {
      if (t.dying > 0 || t.grow < 0.3) continue;
      if (t.contains(x, y) && (!best || t.z > best.z)) best = t;
    }
    return best;
  };

  // corners stick out past the body outline, so they need their own hit test
  const nearCorner = (x, y) => {
    let best = null;
    let bd = CORNER_HOT;
    for (const t of net.tris) {
      if (t.dying > 0 || t.grow < 0.4) continue;
      const v = t.nearestVertex(x, y);
      if (v.d < bd) {
        bd = v.d;
        best = t;
      }
    }
    return best;
  };

  const findEdge = (x, y) => {
    let best = null;
    for (const t of net.tris) {
      if (t.dying > 0 || t.grow < 0.4) continue;
      if (dist(t.x, t.y, x, y) > t.radius() * 2.2) continue;
      const e = t.nearestEdge(x, y);
      if (e.d < EDGE_HOT && (!best || e.d < best.d)) best = { tri: t, index: e.index, d: e.d };
    }
    return best;
  };

  canvas.addEventListener('pointerdown', (ev) => {
    try {
      // synthetic pointers can refuse capture; a drag still works without it
      canvas.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* no capture available */
    }
    const { x, y } = pos(ev);
    if (shell.titleUp()) {
      shell.dismiss(x, y);
      last = { x, y, t: performance.now() };
      return;
    }

    grab.active = true;
    grab.downX = x;
    grab.downY = y;
    grab.downT = performance.now();
    grab.travel = 0;

    const tri = hitTriangle(x, y) || nearCorner(x, y);
    if (tri) {
      const r = Math.hypot(x - tri.x, y - tri.y) / Math.max(1, tri.radius() * tri.scale());
      grab.tri = tri;
      tri.held = true;
      const corner = tri.nearestVertex(x, y);
      if (corner.d < CORNER_HOT) {
        // held by a corner — pull the body's shape about, which retunes its voice
        grab.mode = 'corner';
        grab.corner = corner.index;
      } else if (r < 0.45) {
        // held near the middle — carry it
        grab.mode = 'move';
        grab.offx = x - tri.x;
        grab.offy = y - tri.y;
      } else {
        // held by the rim — turn it, and bend whatever it is sounding
        grab.mode = 'spin';
        grab.prevAngle = Math.atan2(y - tri.y, x - tri.x);
      }
    } else {
      grab.mode = 'sweep';
      grab.tri = null;
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (shell.titleUp()) return; // the axes rest while you are reading
    const { x, y } = pos(ev);
    const now = performance.now();
    // floor the interval, or two moves in one tick read as an infinite velocity
    const dt = Math.max(1 / 240, (now - last.t) / 1000);
    const dx = x - last.x;
    const dy = y - last.y;
    last = { x, y, t: now };

    // a deliberate sweep across empty soil bends the axes harder than a drift
    const gain = grab.active && grab.mode === 'sweep' ? 2.3 : 1;
    net.setMouse(x, y, dx * gain, dy * gain, dt);

    if (!grab.active) return;
    grab.travel += Math.hypot(dx, dy);

    if (grab.mode === 'move' && grab.tri) {
      const t = grab.tri;
      t.x = clamp(x - grab.offx, 20, net.width - 20);
      t.y = clamp(y - grab.offy, 20, net.height - 20);
      t.vx = dx / dt * 0.25;
      t.vy = dy / dt * 0.25;
    } else if (grab.mode === 'corner' && grab.tri) {
      grab.tri.setCorner(grab.corner, x, y);
    } else if (grab.mode === 'spin' && grab.tri) {
      const t = grab.tri;
      const a = Math.atan2(y - t.y, x - t.x);
      const d = angleDelta(a, grab.prevAngle);
      grab.prevAngle = a;
      t.theta += d;
      // blend so a flick reads as momentum rather than a jump; the ceiling is
      // about two turns a second — past that the body is just a blur
      t.omega = clamp(t.omega * 0.55 + (d / dt) * 0.6, -14, 14);
    }
  });

  const release = (ev) => {
    if (!grab.active) return;
    const { x, y } = pos(ev);
    const held = performance.now() - grab.downT;
    const tap = grab.travel < TAP_PX && held < TAP_MS;

    if (grab.tri) grab.tri.held = false;

    if (tap && grab.tri) {
      // strike the edge the field is currently pointing at
      net.fire(grab.tri, grab.tri.activeEdge, 0.82, 0);
    } else if (tap && !grab.tri) {
      net.germinate(x, y);
    }

    grab.active = false;
    grab.mode = null;
    grab.tri = null;
  };

  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('pointerleave', () => {
    net.mouse.inside = false;
  });
  canvas.addEventListener('pointerenter', () => {
    net.mouse.inside = true;
  });

  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      if (shell.titleUp()) return;
      const { x, y } = pos(ev);
      const amt = ev.deltaY;
      const hot = findEdge(x, y);
      if (hot) {
        // nudge one edge into microtonal space
        const e = hot.tri.edges[hot.index];
        e.cents = clamp(e.cents - amt * 0.07, -95, 95);
        e.energy = Math.max(e.energy, 0.18);
        hot.tri.attention = Math.max(hot.tri.attention, 0.4);
        return;
      }
      // otherwise push the nearest fruiting body through depth
      let near = null;
      let nd = Infinity;
      for (const t of net.tris) {
        const d = dist(t.x, t.y, x, y);
        if (d < nd) {
          nd = d;
          near = t;
        }
      }
      if (near && nd < 260) near.z = clamp(near.z - amt * 0.0016, -1, 1);
    },
    { passive: false }
  );

  canvas.addEventListener('dblclick', (ev) => {
    if (shell.titleUp()) return;
    const { x, y } = pos(ev);
    const tri = hitTriangle(x, y);
    if (tri) net.dissolve(tri);
  });

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
}
