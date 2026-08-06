export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

// sine ease-in-out — the house easing
export const ease = (t) => 0.5 - 0.5 * Math.cos(clamp(t, 0, 1) * Math.PI);
export const smoothstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

// frame-rate independent approach: pull `a` toward `b` with time constant `tau`
export const approach = (a, b, tau, dt) => a + (b - a) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));

export const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// shortest signed difference between two angles
export function angleDelta(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

export const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// cheap value noise for organic wobble — deterministic per seed
export function wobble(seed, t) {
  return (
    Math.sin(t * 0.83 + seed * 12.9898) * 0.6 +
    Math.sin(t * 1.71 + seed * 78.233) * 0.3 +
    Math.sin(t * 3.19 + seed * 43.758) * 0.1
  );
}
