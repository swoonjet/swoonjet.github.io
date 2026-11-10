// Easter egg: a claret dot drifts through the moiré. Click it and the Magpies (jontoews.com/magpie/) come out: the
// project runs unseen in a frame behind the page with its sound on. Click again to call them home.
//
// Browsers only allow sound after a click, and the click lands here, not in the frame, so the audio context is made
// here inside the click and handed to Magpie when it asks for one (its "Start listening" handler calls
// new AudioContext(), which then returns ours, already unlocked). The dot holds still under the pointer or keyboard
// focus so it can be caught, and stays put with reduced motion.
(() => {
  const dot = document.querySelector(".egg");
  if (!dot) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const label = dot.querySelector(".egg__label");
  let frame = null, ac = null, held = false, t = Math.random() * 600, last = performance.now();

  // the drift: two slow sines per axis, bent by slower ones, so the path never quite repeats
  function place(now) {
    if (!held && !still) t += Math.min(0.1, (now - last) / 1000);
    last = now;
    const m = 28, w = innerWidth - 2 * m, h = innerHeight - 2 * m;
    const x = m + w * (0.5 + 0.46 * Math.sin(t * 0.045 + 1.7 * Math.sin(t * 0.015)));
    const y = m + h * (0.5 + 0.44 * Math.sin(t * 0.034 + 1.3 + 1.7 * Math.cos(t * 0.012)));
    dot.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (!still) requestAnimationFrame(place);
  }
  requestAnimationFrame(place);
  for (const [on, off] of [["pointerenter", "pointerleave"], ["focus", "blur"]]) {
    dot.addEventListener(on, () => (held = true));
    dot.addEventListener(off, () => (held = false));
  }

  function out() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC();
    ac.resume();
    const half = ac.createGain();                   // the Magpies at half volume:
    half.gain.value = 0.5;                          // whatever Magpie connects to "the speakers" lands here first
    half.connect(ac.destination);
    Object.defineProperty(ac, "destination", { value: half });
    frame = document.createElement("iframe");
    frame.className = "egg-frame";
    frame.src = dot.dataset.src;
    frame.title = "Magpie";
    frame.tabIndex = -1;
    frame.allow = "autoplay";
    frame.setAttribute("aria-hidden", "true");
    frame.addEventListener("load", () => {
      const w = frame.contentWindow, shared = ac;
      if (!w || !shared) return;
      const Given = function () { return shared; };
      w.AudioContext = w.webkitAudioContext = Given;
      w.document.getElementById("begin-btn")?.click();
    }, { once: true });
    document.body.appendChild(frame);
    set(true);
  }
  function home() {
    frame?.remove(); frame = null;
    ac?.close(); ac = null;
    set(false);
  }
  function set(on) {
    dot.classList.toggle("is-out", on);
    dot.setAttribute("aria-pressed", String(on));
    label.textContent = on ? "Call the Magpies home (stops the sound)" : "Let the Magpies out (turns on sound)";
  }
  dot.addEventListener("click", () => (frame ? home() : out()));
})();
