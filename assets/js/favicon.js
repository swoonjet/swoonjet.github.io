// The tab icon: "JT" in Trapu Tall on claret. Every so often it flickers through Jon's nine typefaces and lands back
// on Trapu Tall. Outlines come from assets/favicon-faces.json (built by tools/favicon.py), fetched only once the page
// has settled. Browsers that ignore favicon changes (Safari) simply keep the static icon.
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const link = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
  if (!link) return;
  const home = link.href, src = new URL("favicon-faces.json", home);
  const c = document.createElement("canvas"), x = c.getContext("2d");
  c.width = c.height = 64;
  let faces = null, busy = false;

  function draw(f) {
    const [x0, y0, x1, y1] = f.box, s = Math.min(46 / (x1 - x0), 40 / (y1 - y0));
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = "#7b1838"; x.fillRect(0, 0, 64, 64);
    x.setTransform(s, 0, 0, s, 32 - ((x0 + x1) / 2) * s, 32 - ((y0 + y1) / 2) * s);
    x.fillStyle = "#f2f1ee"; x.fill(new Path2D(f.d));
    link.href = c.toDataURL("image/png");
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function flicker() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      faces = faces || (await fetch(src).then((r) => r.json()));
      for (const f of faces.slice(1)) { draw(f); await wait(170); }
    } catch (e) { /* no faces file: keep the static icon */ }
    link.href = home;
    busy = false;
  }
  setTimeout(() => { flicker(); setInterval(flicker, 12000); }, 2500);
})();
