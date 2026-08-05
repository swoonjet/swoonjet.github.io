// The three-dimensional spectrogram space.
//
// Each channel is a layer: a ridge plot of its own history, frequency across,
// time receding, amplitude up. Layers are stacked and slightly fanned so they
// occupy the same space without collapsing into each other. Where two layers
// hold energy at the same frequency at the same moment, a vertical thread is
// drawn between them — the visual chord.
//
// Hidden-line removal is done the old way: fill under each ridge with paper,
// then draw the ridge on top with a polygon offset. Restraint in the geometry,
// chaos in the data.

import { CONFIG, CHANNEL_INKS } from '../core/config.js';
import { perspective, lookAt, multiply, translationRotationY, transformPoint } from './mat4.js';
import { easeSine, clamp } from '../core/util.js';

const PAPER = [0.949, 0.941, 0.922];
const DEG = Math.PI / 180;

/** The vertex shader's response curve, in JS, so chord threads land on the ridges. */
function shapeAmp(v) {
  const { knee, curve } = CONFIG.visual;
  return Math.pow(Math.max(v - knee, 0) / Math.max(1 - knee, 0.001), curve);
}

const RIDGE_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_tex;
uniform mat4 u_viewProj;
uniform mat4 u_model;
uniform int u_bands;
uniform int u_rows;
uniform int u_head;
uniform int u_stride;
uniform int u_drawRows;
uniform float u_width;
uniform float u_depth;
uniform float u_height;
uniform float u_knee;
uniform float u_curve;
uniform float u_sparkSize;

out float v_amp;
out float v_u;
out float v_v;
out float v_fill;   // 1 at the ridge, 0 at the base — the shading gradient

void main() {
  int vid = gl_VertexID;
  int isBase = vid & 1;
  int cell = vid >> 1;
  int band = cell % u_bands;
  int drawAge = cell / u_bands;
  int age = drawAge * u_stride;

  int texRow = (u_head - age + u_rows * 2) % u_rows;
  float amp = texelFetch(u_tex, ivec2(band, texRow), 0).r;

  float u = float(band) / float(u_bands - 1);
  float v = float(drawAge) / float(u_drawRows - 1);

  // Shape the response so the quiet floor stays flat and events actually rise.
  // A low knee and a gentle curve keep faint field-recording detail visible.
  float shaped = pow(max(amp - u_knee, 0.0) / max(1.0 - u_knee, 0.001), u_curve);

  float x = (u - 0.5) * u_width;
  float z = -v * u_depth;
  float y = (isBase == 1) ? 0.0 : shaped * u_height;

  v_amp = shaped;
  v_u = u;
  v_v = v;
  v_fill = (isBase == 1) ? 0.0 : 1.0;
  gl_Position = u_viewProj * u_model * vec4(x, y, z, 1.0);
}`;

const FILL_FS = `#version 300 es
precision highp float;
in float v_amp; in float v_u; in float v_v; in float v_fill;
uniform vec3 u_paper;
uniform vec3 u_ink;
uniform float u_shade;
uniform float u_floor;
out vec4 fragColor;
void main() {
  // Silence must not occlude. Without this, the flat base of an upper layer
  // becomes a horizontal sheet that hides every layer beneath it. The threshold
  // is the same one the ridge line uses, so shading never appears under a ridge
  // that is not itself drawn.
  if (v_amp < u_floor) discard;

  // Shading. Bare ridge lines read as a thicket of squiggles with no way to tell
  // one source from another; a tint under each ridge gives every layer a form and
  // separates it from the layers behind. Densest just under the ridge, falling
  // away downward, and fading with age so the newest material reads first.
  // Stays fully opaque: this surface is what does the hidden-line removal.
  float grad = pow(clamp(v_fill, 0.0, 1.0), 0.7);
  float lift = smoothstep(u_floor, 1.0, v_amp);
  float amount = u_shade * grad * (0.35 + 0.65 * lift) * (1.0 - v_v * 0.55);
  fragColor = vec4(mix(u_paper, u_ink, clamp(amount, 0.0, 1.0)), 1.0);
}`;

const LINE_FS = `#version 300 es
precision highp float;
in float v_amp; in float v_u; in float v_v; in float v_fill;
uniform vec3 u_ink;
uniform vec3 u_accent;
uniform float u_fade;
uniform float u_lineKnee;
uniform float u_lineFull;
out vec4 fragColor;
void main() {
  // High frequency reads hot, low frequency reads heavy.
  vec3 col = mix(u_ink, u_accent, smoothstep(0.55, 0.95, v_u) * smoothstep(0.10, 0.45, v_amp));
  // The quiet floor draws nothing at all — paper stays paper until the room
  // does something. Restraint is the point.
  float weight = smoothstep(u_lineKnee, u_lineFull, v_amp);
  float depthFade = 1.0 - v_v * u_fade;
  fragColor = vec4(col, weight * depthFade * 0.95);
}`;

const SPARK_FS = `#version 300 es
precision highp float;
in float v_amp; in float v_u; in float v_v; in float v_fill;
uniform vec3 u_accent;
uniform float u_sparkBand;
uniform float u_sparkThreshold;
uniform float u_sparkAlpha;
out vec4 fragColor;
void main() {
  if (v_u < u_sparkBand || v_amp < u_sparkThreshold) discard;
  vec2 d = gl_PointCoord - vec2(0.5);
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  // Soft-edged rather than a hard disc: a spark should read as a glint on the
  // ridge, not as a dot sitting on top of the drawing.
  float edge = 1.0 - smoothstep(0.06, 0.25, r2);
  fragColor = vec4(u_accent, u_sparkAlpha * (0.3 + 0.7 * v_amp) * (1.0 - v_v * 0.8) * edge);
}`;

const SPARK_VS = RIDGE_VS.replace(
  'gl_Position = u_viewProj * u_model * vec4(x, y, z, 1.0);',
  'gl_Position = u_viewProj * u_model * vec4(x, y, z, 1.0);\n  gl_PointSize = (0.7 + shaped * u_sparkSize) * (1.0 - v * 0.6);',
);

const PLAIN_VS = `#version 300 es
precision highp float;
in vec3 a_pos;
in float a_weight;
uniform mat4 u_viewProj;
out float v_weight;
void main() {
  v_weight = a_weight;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}`;

const PLAIN_FS = `#version 300 es
precision highp float;
in float v_weight;
uniform vec3 u_colour;
uniform float u_alpha;
out vec4 fragColor;
void main() { fragColor = vec4(u_colour, u_alpha * v_weight); }`;

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL2 is required for the visualiser.');
    this.layers = [];
    this.layerByChannel = new Map();
    // Start mid-swing rather than at an extreme of the orbit.
    this.orbitMs = CONFIG.visual.orbitPeriodSec * 250;
    this.chordCount = 0;
    this.bands = CONFIG.audio.bands;
    this.rows = CONFIG.history.rows;
    this.stride = Math.max(1, CONFIG.visual.rowStride);
    this.drawRows = Math.floor(this.rows / this.stride);
    this.build();
  }

  build() {
    const gl = this.gl;
    this.fillProg = program(gl, RIDGE_VS, FILL_FS);
    this.lineProg = program(gl, RIDGE_VS, LINE_FS);
    this.sparkProg = program(gl, SPARK_VS, SPARK_FS);
    this.plainProg = program(gl, PLAIN_VS, PLAIN_FS);

    const { bands } = this;
    const rows = this.drawRows;
    const idx = (age, band, base) => ((age * bands + band) * 2 + (base ? 1 : 0));

    // Filled skirt under each ridge, for hidden-line removal.
    const fill = new Uint32Array((bands - 1) * 6 * rows);
    let f = 0;
    for (let a = 0; a < rows; a++) {
      for (let b = 0; b < bands - 1; b++) {
        const r0 = idx(a, b, false), b0 = idx(a, b, true);
        const r1 = idx(a, b + 1, false), b1 = idx(a, b + 1, true);
        fill[f++] = r0; fill[f++] = b0; fill[f++] = r1;
        fill[f++] = r1; fill[f++] = b0; fill[f++] = b1;
      }
    }

    // The ridge itself.
    const lines = new Uint32Array((bands - 1) * 2 * rows);
    let l = 0;
    for (let a = 0; a < rows; a++) {
      for (let b = 0; b < bands - 1; b++) {
        lines[l++] = idx(a, b, false);
        lines[l++] = idx(a, b + 1, false);
      }
    }

    // Sparks sit on ridge vertices of the most recent third of history.
    const sparkRows = Math.floor(rows * 0.34);
    const sparks = new Uint32Array(bands * sparkRows);
    let s = 0;
    for (let a = 0; a < sparkRows; a++) {
      for (let b = 0; b < bands; b++) sparks[s++] = idx(a, b, false);
    }

    this.fillVao = this.indexVao(fill);
    this.lineVao = this.indexVao(lines);
    this.sparkVao = this.indexVao(sparks);
    this.counts = { fill: fill.length, line: lines.length, spark: sparks.length };

    // Dynamic buffer shared by the chord threads and the layer frames.
    this.plainVao = gl.createVertexArray();
    gl.bindVertexArray(this.plainVao);
    this.plainBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.plainBuf);
    gl.bufferData(gl.ARRAY_BUFFER, (CONFIG.visual.chordMax * 2 + 64) * 16, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(this.plainProg.p, 'a_pos');
    const wLoc = gl.getAttribLocation(this.plainProg.p, 'a_weight');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(wLoc);
    gl.vertexAttribPointer(wLoc, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);
    this.chordData = new Float32Array((CONFIG.visual.chordMax * 2 + 64) * 4);

    this.viewProj = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.view = new Float32Array(16);
  }

  indexVao(indices) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return vao;
  }

  /**
   * One layer per live channel, keyed by the channel's stable id.
   *
   * Keying on array position would hand a new microphone the previous
   * occupant's several seconds of history the moment anything was removed.
   */
  syncLayers(channels) {
    const gl = this.gl;
    const present = new Set();

    this.layers = channels.map((channel) => {
      present.add(channel.id);
      let layer = this.layerByChannel.get(channel.id);
      if (!layer) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, this.bands, this.rows);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        layer = { tex, model: new Float32Array(16), ink: channel.ink ?? CHANNEL_INKS[0] };
        this.layerByChannel.set(channel.id, layer);
      }
      return layer;
    });

    // Release the GPU memory of anything that has left the piece.
    for (const [id, layer] of this.layerByChannel) {
      if (present.has(id)) continue;
      gl.deleteTexture(layer.tex);
      this.layerByChannel.delete(id);
    }

    // Restack so the set is always centred on the horizon.
    const n = channels.length;
    for (let i = 0; i < n; i++) {
      const y = (i - (n - 1) / 2) * CONFIG.visual.layerGap;
      const yaw = (i - (n - 1) / 2) * CONFIG.visual.yawPerChannel * DEG;
      translationRotationY(0, y, 0, yaw, this.layers[i].model);
      this.layers[i].baseY = y;
      this.layers[i].yaw = yaw;
      this.layers[i].ink = channels[i].ink;
    }
  }

  /**
   * Push every spectrogram row that has advanced since the last draw. Uploading
   * only the newest row leaves holes whenever analysis outruns the display.
   */
  uploadFrames(channels) {
    const gl = this.gl;
    for (let i = 0; i < channels.length && i < this.layers.length; i++) {
      const layer = this.layers[i];
      const sg = channels[i].spectrogram;
      gl.bindTexture(gl.TEXTURE_2D, layer.tex);

      const from = layer.uploaded == null ? sg.head : layer.uploaded;
      let pending = (sg.head - from + this.rows) % this.rows;
      if (layer.uploaded == null) pending = 1;
      pending = Math.min(pending, this.rows);

      for (let k = pending; k >= 1; k--) {
        const row = (sg.head - k + 1 + this.rows) % this.rows;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, this.bands, 1, gl.RED, gl.FLOAT,
          sg.data, row * this.bands);
      }
      layer.uploaded = sg.head;
      layer.head = sg.head;
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return [w, h];
  }

  camera(dtMs) {
    this.orbitMs += dtMs;
    const period = CONFIG.visual.orbitPeriodSec * 1000;
    // Sine ease in both directions: the camera never lands hard.
    const phase = (this.orbitMs % period) / period;
    const swing = easeSine(phase < 0.5 ? phase * 2 : (1 - phase) * 2) * 2 - 1;
    const az = swing * CONFIG.visual.orbitDegrees * DEG;
    // High enough that each row of history clears the row in front of it —
    // below about 25 degrees the ridge plot collapses onto its newest frame.
    const el = (CONFIG.visual.orbitElevation + Math.sin((this.orbitMs / 1000) * 0.05) * 4) * DEG;

    const r = CONFIG.visual.orbitRadius;

    // Aim at the centroid of the drawn volume. The layers straddle y=0 and the
    // ridges only ever rise, so the visual centre of mass sits above the stack's
    // midpoint — aiming at y=0 pushes everything below the frame.
    const target = [
      0,
      CONFIG.visual.height * CONFIG.visual.aimFactor,
      -CONFIG.visual.depth * 0.5,
    ];

    // The eye orbits *the aim point*, not the world origin. Orbiting the origin
    // while looking somewhere else swings the whole plot sideways across the
    // frame as the camera moves — which is why it kept ending up hard against
    // the left edge.
    const eye = [
      target[0] + Math.sin(az) * Math.cos(el) * r,
      target[1] + Math.sin(el) * r,
      target[2] + Math.cos(az) * Math.cos(el) * r,
    ];

    const [w, h] = [this.canvas.width, this.canvas.height];
    perspective(CONFIG.visual.fovDegrees * DEG, w / h, 0.1, 60, this.proj);
    lookAt(eye, target, [0, 1, 0], this.view);
    multiply(this.proj, this.view, this.viewProj);
  }

  /**
   * Vertical threads wherever two layers hold energy at the same band and the
   * same moment. Computed on the CPU over the newest rows only.
   */
  buildChords(channels) {
    const V = CONFIG.visual;
    const data = this.chordData;
    let n = 0;
    const maxPairs = V.chordMax;
    const rows = Math.min(V.chordRows, this.drawRows);

    outer:
    for (let a = 0; a < channels.length - 1; a++) {
      for (let b = a + 1; b < channels.length; b++) {
        const sa = channels[a].spectrogram, sb = channels[b].spectrogram;
        for (let drawAge = 0; drawAge < rows; drawAge += 2) {
          const age = drawAge * this.stride;
          for (let band = 0; band < this.bands; band += 3) {
            const va = sa.valueAt(age, band);
            if (va < V.chordThreshold) continue;
            const vb = sb.valueAt(age, band);
            if (vb < V.chordThreshold) continue;

            const u = band / (this.bands - 1);
            const v = drawAge / (this.drawRows - 1);
            const shapeA = shapeAmp(va);
            const shapeB = shapeAmp(vb);
            const p0 = transformPoint(this.layers[a].model, [
              (u - 0.5) * V.width, shapeA * V.height, -v * V.depth,
            ]);
            const p1 = transformPoint(this.layers[b].model, [
              (u - 0.5) * V.width, shapeB * V.height, -v * V.depth,
            ]);
            const weight = clamp(Math.min(va, vb) * 1.5, 0, 1) * (1 - v * 0.8);
            data[n * 4] = p0[0]; data[n * 4 + 1] = p0[1]; data[n * 4 + 2] = p0[2]; data[n * 4 + 3] = weight;
            n++;
            data[n * 4] = p1[0]; data[n * 4 + 1] = p1[1]; data[n * 4 + 2] = p1[2]; data[n * 4 + 3] = weight;
            n++;
            if (n >= maxPairs * 2) break outer;
          }
        }
      }
    }
    this.chordCount = n;
    if (n > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.plainBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * 4));
    }
  }

  draw(channels, dtMs) {
    const gl = this.gl;
    const [w, h] = this.resize();
    this.syncLayers(channels);
    this.uploadFrames(channels);
    this.camera(dtMs);

    gl.viewport(0, 0, w, h);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const V = CONFIG.visual;

    for (let i = 0; i < channels.length && i < this.layers.length; i++) {
      const layer = this.layers[i];

      // 1. Opaque skirt: hides everything behind this ridge.
      gl.useProgram(this.fillProg.p);
      this.setRidgeUniforms(this.fillProg, layer);
      gl.uniform3fv(this.fillProg.u.u_paper, PAPER);
      gl.uniform3fv(this.fillProg.u.u_ink, layer.ink.rgb);
      gl.uniform1f(this.fillProg.u.u_shade, V.shade);
      gl.uniform1f(this.fillProg.u.u_floor, V.lineKnee);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.4, 2.0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.fillVao);
      gl.drawElements(gl.TRIANGLES, this.counts.fill, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);

      // 2. The ridge line.
      gl.useProgram(this.lineProg.p);
      this.setRidgeUniforms(this.lineProg, layer);
      gl.uniform3fv(this.lineProg.u.u_ink, layer.ink.rgb);
      gl.uniform3fv(this.lineProg.u.u_accent, [0.85, 0.24, 0.09]);
      gl.uniform1f(this.lineProg.u.u_fade, 0.72);
      gl.uniform1f(this.lineProg.u.u_lineKnee, V.lineKnee);
      gl.uniform1f(this.lineProg.u.u_lineFull, V.lineFull);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindVertexArray(this.lineVao);
      gl.drawElements(gl.LINES, this.counts.line, gl.UNSIGNED_INT, 0);

      // 3. Sparks on the high bands.
      gl.useProgram(this.sparkProg.p);
      this.setRidgeUniforms(this.sparkProg, layer);
      gl.uniform3fv(this.sparkProg.u.u_accent, [0.85, 0.24, 0.09]);
      gl.uniform1f(this.sparkProg.u.u_sparkBand, V.sparkBand);
      gl.uniform1f(this.sparkProg.u.u_sparkThreshold, V.sparkThreshold);
      gl.uniform1f(this.sparkProg.u.u_sparkAlpha, V.sparkAlpha);
      gl.bindVertexArray(this.sparkVao);
      gl.drawElements(gl.POINTS, this.counts.spark, gl.UNSIGNED_INT, 0);
    }

    // 4. The chords between layers.
    if (channels.length > 1) {
      this.buildChords(channels);
      if (this.chordCount > 1) {
        gl.useProgram(this.plainProg.p);
        gl.uniformMatrix4fv(this.plainProg.u.u_viewProj, false, this.viewProj);
        gl.uniform3fv(this.plainProg.u.u_colour, [0.85, 0.24, 0.09]);
        gl.uniform1f(this.plainProg.u.u_alpha, V.chordAlpha);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.bindVertexArray(this.plainVao);
        gl.drawArrays(gl.LINES, 0, this.chordCount);
      }
    }

    gl.bindVertexArray(null);
    gl.depthMask(true);
  }

  setRidgeUniforms(prog, layer) {
    const gl = this.gl;
    const V = CONFIG.visual;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer.tex);
    gl.uniform1i(prog.u.u_tex, 0);
    gl.uniformMatrix4fv(prog.u.u_viewProj, false, this.viewProj);
    gl.uniformMatrix4fv(prog.u.u_model, false, layer.model);
    gl.uniform1i(prog.u.u_bands, this.bands);
    gl.uniform1i(prog.u.u_rows, this.rows);
    gl.uniform1i(prog.u.u_stride, this.stride);
    gl.uniform1i(prog.u.u_drawRows, this.drawRows);
    gl.uniform1i(prog.u.u_head, layer.head ?? 0);
    gl.uniform1f(prog.u.u_width, V.width);
    gl.uniform1f(prog.u.u_depth, V.depth);
    gl.uniform1f(prog.u.u_height, V.height);
    gl.uniform1f(prog.u.u_knee, V.knee);
    gl.uniform1f(prog.u.u_curve, V.curve);
    gl.uniform1f(prog.u.u_sparkSize, V.sparkSize);
  }
}
