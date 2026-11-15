// Tex's renderer: the same Python as the desktop studio, run in the browser by Pyodide.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";
importScripts(PYODIDE + "pyodide.js");

let py = null, tex = null;
const say = (text) => postMessage({ type: "status", text });

// crystals' shards, drawn onto a canvas over the image underneath (see skia.py)
self.texTris = (w, h, px, xy, rgba, blend) => {
  const cv = new OffscreenCanvas(w, h), g = cv.getContext("2d");
  g.putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, w * h * 4), w, h), 0, 0);
  g.globalCompositeOperation = blend;
  const m = rgba.length / 4;
  for (let i = 0; i < m; i++) {
    const a = rgba[i * 4 + 3];
    if (!a) continue;
    g.fillStyle = `rgba(${rgba[i * 4]},${rgba[i * 4 + 1]},${rgba[i * 4 + 2]},${a / 255})`;
    const j = i * 6;
    g.beginPath(); g.moveTo(xy[j], xy[j + 1]); g.lineTo(xy[j + 2], xy[j + 3]); g.lineTo(xy[j + 4], xy[j + 5]); g.fill();
  }
  return g.getImageData(0, 0, w, h).data;
};

async function boot(zip) {
  say("loading Python…");
  py = await loadPyodide({ indexURL: PYODIDE });
  say("loading numpy, OpenCV and Pillow…");
  await py.loadPackage(["numpy", "opencv-python", "pillow"]);
  say("loading Tex…");
  py.unpackArchive(await (await fetch(zip)).arrayBuffer(), "zip", { extractDir: "/home/pyodide/tex" });
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide/tex')");
  tex = py.pyimport("tex_web");
  return JSON.parse(tex.config());
}

onmessage = async ({ data: m }) => {
  try {
    let out;
    if (m.op === "boot") out = await boot(m.zip);
    else if (m.op === "derive") out = JSON.parse(tex.derive(m.color));
    else if (m.op === "render") {
      const t = performance.now();
      const b = tex.render(JSON.stringify(m.params), m.w, m.h, m.ss, m.fmt);
      const bytes = b.toJs(); b.destroy();
      out = { bytes, ms: performance.now() - t };
      return postMessage({ id: m.id, ok: true, out }, [bytes.buffer]);
    }
    postMessage({ id: m.id, ok: true, out });
  } catch (e) {
    postMessage({ id: m.id, ok: false, error: String(e && e.message || e).split("\n").filter(Boolean).slice(-1)[0] });
  }
};
