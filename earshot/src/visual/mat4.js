// Just enough 4x4 matrix maths for one camera and a handful of layers.
// Column-major, the order WebGL expects.

export function identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function multiply(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function perspective(fovyRad, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan(fovyRad / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(eye, centre, up, out = new Float32Array(16)) {
  const z = normalize(sub(eye, centre));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2];  out[12] = -dot(x, eye);
  out[1] = y[0]; out[5] = y[1]; out[9] = y[2];  out[13] = -dot(y, eye);
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2]; out[14] = -dot(z, eye);
  out[3] = 0;    out[7] = 0;    out[11] = 0;    out[15] = 1;
  return out;
}

export function translationRotationY(tx, ty, tz, yawRad, out = new Float32Array(16)) {
  const c = Math.cos(yawRad), s = Math.sin(yawRad);
  out[0] = c;  out[1] = 0; out[2] = -s; out[3] = 0;
  out[4] = 0;  out[5] = 1; out[6] = 0;  out[7] = 0;
  out[8] = s;  out[9] = 0; out[10] = c; out[11] = 0;
  out[12] = tx; out[13] = ty; out[14] = tz; out[15] = 1;
  return out;
}

export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
