// A waveform in the address bar: two sine waves a hair apart in pitch, summed, so they beat (moiré, in one dimension),
// scrolling past after the "#". Scrolling the page turns the volume up. Drawn in braille dots rising from the baseline:
// the crest and the baseline solid, the body stippled, so the outline of each peak and valley reads darkest.
// Never adds history entries; puts the clean URL back whenever the tab is hidden or the page is left, so bookmarks and
// shared links stay clean; steps aside for real #anchors. Skipped with reduced motion and in Safari (which only shows
// the domain and limits URL rewrites) and on phones.
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (/^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)) return;
  if (matchMedia("(pointer: coarse)").matches) return;          // phones show only the domain
  const W = 28, FPS = 8;                                        // 28 characters wide; 8 rewrites a second, inside every browser's limit
  const clean = () => location.pathname + location.search;
  let t = 0, energy = 0, lastY = scrollY, timer = 0;

  // a braille character is a 2 x 4 grid of dots; these are the bits for each dot, by column then row (top to bottom)
  const DOT = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];
  const sample = (i) => {                                       // the beat: amplitude -1..1
    const x = i * 0.42 - t;
    const v = (Math.sin(x) + Math.sin(x * 1.22 + t * 0.35)) * 0.62 * (0.8 + 0.25 * Math.min(1, energy));
    return Math.sign(v) * Math.min(1, Math.abs(v)) ** 0.55;   // contrast curve: push the wave out to its peaks and valleys
  };
  const level = (i) => Math.round((sample(i) + 1) / 2 * 3) + 1;   // how many dots stand up from the bottom: 1..4
  function frame() {
    let s = "";
    for (let c = 0; c < W; c++) {
      let code = 0x2800;
      for (let k = 0; k < 2; k++) {                             // each half-column: a solid crest and baseline, stippled between
        const i = c * 2 + k, h = level(i);
        for (let n = 0; n < h; n++) if (n === 0 || n === h - 1 || (i + n) % 2) code |= DOT[k][3 - n];
      }
      s += String.fromCharCode(code);
    }
    return s;
  }

  function tick() {
    if (document.hidden) return;
    if (location.hash && !ours()) return;                       // a real #anchor is in charge
    t += 0.55; energy *= 0.9;
    try { history.replaceState(history.state, "", clean() + "#" + frame()); }
    catch (e) { stop(); }                                       // the browser said slow down: stop for good
  }
  // a hash of nothing but braille is a waveform, this visit's or one left in the URL by a reload or a copied link
  function ours() { try { return /^[\u2800-\u28ff]+$/.test(decodeURIComponent(location.hash.slice(1))); } catch (e) { return false; } }
  function rest() { if (location.hash && ours()) history.replaceState(history.state, "", clean()); }
  function start() { if (!timer) timer = setInterval(tick, 1000 / FPS); }
  function stop() { clearInterval(timer); timer = 0; rest(); }

  addEventListener("scroll", () => { energy = Math.min(2, energy + Math.abs(scrollY - lastY) / 400); lastY = scrollY; }, { passive: true });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  addEventListener("pagehide", rest);
  rest();                                                       // arrived with an old waveform in the URL: clear it first
  setTimeout(start, 1200);
})();
