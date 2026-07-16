/* ============================================================
   Hero engine — random rotation, one full-bleed video per scene.
   Only manifest entries flagged `hero: true` are used (landscape
   clips, plus square clips that survive a heavy centre crop —
   curated in tools/build-manifest.py). Scenes crossfade on a
   long sine ease.
   ============================================================ */

(async function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let pool = [];
  try {
    pool = await (await fetch("manifest.json")).json();
  } catch (e) {
    console.warn("manifest.json missing — hero stays dark", e);
    return;
  }

  aboutVideo(reduceMotion);

  const stage = document.getElementById("heroStage");
  let heroPool = pool.filter((v) => v.hero);
  // portrait phones: landscape films crop to a sliver — prefer the
  // square/vertical picks, which fill a tall screen beautifully
  if (
    window.IS_MOBILE &&
    window.matchMedia("(orientation: portrait)").matches
  ) {
    const panels = heroPool.filter((v) => v.kind === "panel");
    if (panels.length >= 3) heroPool = panels;
  }
  if (!stage || heroPool.length === 0) return;

  /* ---------- shuffle queue: every hero video appears once per cycle ---------- */

  let queue = [];
  function refill() {
    queue = heroPool.slice();
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
  }

  function takeNext() {
    if (queue.length === 0) refill();
    return queue.shift();
  }

  /* ---------- scene construction ---------- */

  function makeVideo(item) {
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.preload = "auto";
    v.poster = item.poster;
    v.src = item.src;
    // per-video framing set in picker.html: pan via object-position,
    // zoom scales around the same focal point
    const x = item.x ?? 50;
    const y = item.y ?? 50;
    const z = (item.zoom ?? 100) / 100;
    v.style.objectPosition = `${x}% ${y}%`;
    if (z !== 1) {
      v.style.transform = `scale(${z})`;
      v.style.transformOrigin = `${x}% ${y}%`;
    }
    // clip in/out points set in picker.html: start there, loop the range
    const start = item.start ?? 0;
    const end = item.end ?? null;
    if (start > 0) {
      // don't fade the scene in until the seek has landed
      v._seekReady = new Promise((res) => {
        v.addEventListener("seeked", res, { once: true });
        setTimeout(res, 5000);
      });
      v.addEventListener("loadedmetadata", () => { v.currentTime = start; }, { once: true });
    }
    if (end || start > 0) {
      v.addEventListener("timeupdate", () => {
        if (end && v.currentTime >= end) {
          // while fading out, hold the last frame instead of looping —
          // a restart mid-crossfade reads as a glitch
          if (v._fading) v.pause();
          else v.currentTime = start;
        }
      });
    }
    return v;
  }

  function buildScene() {
    const item = takeNext();
    const scene = document.createElement("div");
    scene.className = "hero-scene solo";
    const vids = [makeVideo(item)];
    scene.appendChild(vids[0]);
    const hasClip = (item.start ?? 0) > 0 || item.end != null;
    const clipLen = (item.end ?? item.dur) - (item.start ?? 0);
    // an explicit in/out range plays in full — the edit is the authority;
    // unclipped videos get the default 6–15s hold. Clipped scenes fade a
    // beat early so the range-loop can never fire before the fade begins.
    scene.dataset.hold = hasClip
      ? Math.max(3, clipLen - 0.3)
      : Math.max(6, Math.min(15, clipLen));
    return { scene, vids };
  }

  function ready(video, timeoutMs) {
    const canplay = new Promise((resolve) => {
      if (video.readyState >= 3) return resolve();
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, timeoutMs);
      video.addEventListener("canplay", done, { once: true });
    });
    return video._seekReady ? Promise.all([canplay, video._seekReady]) : canplay;
  }

  /* ---------- rotation loop ---------- */

  let current = null;
  let next = buildScene();
  let timer = null;
  let running = true;
  let sceneStart = 0; // when the current scene's clock started
  let sceneRemaining = 0; // ms of hold left (survives pause/resume)

  async function showNext() {
    const incoming = next;
    stage.appendChild(incoming.scene);
    await Promise.all(incoming.vids.map((v) => ready(v, 3500)));
    incoming.vids.forEach((v) => v.play().catch(() => {}));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => incoming.scene.classList.add("live"))
    );

    if (current) {
      const old = current;
      // freeze instead of looping while the fade plays out
      old.vids.forEach((v) => { v._fading = true; v.loop = false; });
      old.scene.classList.remove("live");
      setTimeout(() => {
        old.vids.forEach((v) => { v.pause(); v.removeAttribute("src"); v.load(); });
        old.scene.remove();
      }, 2100);
    }
    current = incoming;

    if (reduceMotion) return; // hold the first scene, no rotation

    next = buildScene(); // preloads while current scene plays
    clearTimeout(timer);
    sceneRemaining = Number(incoming.scene.dataset.hold) * 1000;
    sceneStart = Date.now();
    timer = setTimeout(showNext, sceneRemaining);
  }

  showNext();

  /* pause the show when the tab or hero is off-screen */

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (!current) return;
    if (on) {
      current.vids.forEach((v) => v.play().catch(() => {}));
      if (!reduceMotion) {
        // resume with the hold time the scene had left (min 3s of viewing)
        clearTimeout(timer);
        sceneStart = Date.now();
        sceneRemaining = Math.max(3000, sceneRemaining);
        timer = setTimeout(showNext, sceneRemaining);
      }
    } else {
      clearTimeout(timer);
      sceneRemaining = Math.max(0, sceneRemaining - (Date.now() - sceneStart));
      current.vids.forEach((v) => v.pause());
    }
  }

  document.addEventListener("visibilitychange", () =>
    setRunning(!document.hidden)
  );

  const hero = document.querySelector(".hero");
  new IntersectionObserver(
    (entries) => setRunning(entries[0].isIntersecting && !document.hidden),
    { threshold: 0.05 }
  ).observe(hero);

  /* nav: 50% over the hero, solid site background over content */
  const head = document.getElementById("siteHead");
  if (head) {
    new IntersectionObserver((entries) =>
      head.classList.toggle("solid", !entries[0].isIntersecting)
    ).observe(hero);
  }
})();

/* ============ About video ============ */
/* Plays the flower self-portrait film while it's on screen. */

function aboutVideo(reduceMotion) {
  const v = document.getElementById("aboutVideo");
  if (!v || reduceMotion) return; // reduced motion: poster only
  new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) v.play().catch(() => {});
      else v.pause();
    },
    { threshold: 0.25 }
  ).observe(v);
}
