// Type section behaviour: fit the name to the grid, the tester, the character-set loupe, and each
// specimen's interaction (Annulet iris, Chronolith keyboard, Culvert Waterways + cuts, Trapu ss01).
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // the typeface name, set in itself, fills the full content width
  function fit() {
    $$("[data-fit]").forEach((el) => {
      el.style.fontSize = "100px";
      const w = el.parentElement.getBoundingClientRect().width;
      el.style.fontSize = Math.min(260, (100 * w) / el.scrollWidth) * 0.995 + "px";
    });
  }
  // long specimen lines (the widest cuts, previous/next names) step down to fit their column instead of being clipped
  function shrink() {
    $$(".cv__w, .cut__w, .tf-pn__n").forEach((el) => {
      el.style.fontSize = "";
      const room = Math.min(el.clientWidth, el.parentElement.clientWidth);   // a grid item can grow past its column
      const over = el.scrollWidth / room;
      if (over > 1.001) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) / over) * 0.98 + "px";
    });
  }
  document.fonts.ready.then(() => { fit(); shrink(); });
  addEventListener("resize", () => { fit(); shrink(); });

  // tester: size slider and style buttons
  const out = $("[data-tester]");
  if (out) {
    const size = $("[data-size]");
    size.addEventListener("input", () => out.style.setProperty("--tt", size.value + "px"));
    out.style.setProperty("--tt", size.value + "px");
    $$(".tt__styles button").forEach((b) => b.addEventListener("click", () => {
      $$(".tt__styles button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      out.style.fontFamily = `'${b.dataset.family}'`;
    }));
  }

  // character set loupe
  const big = $(".cs__big"), cp = $(".cs__cp");
  $$(".cs__cell").forEach((c) => {
    const show = () => {
      $$(".cs__cell.is-on").forEach((x) => x.classList.remove("is-on"));
      c.classList.add("is-on"); big.textContent = c.textContent; cp.textContent = c.dataset.cp;
    };
    c.addEventListener("mouseenter", show); c.addEventListener("focus", show); c.addEventListener("click", show);
  });
  $(".cs__cell")?.classList.add("is-on");

  // Annulet: the aperture closes, the glyph changes, it opens again
  const iris = $("[data-iris]");
  if (iris) {
    const glyphs = [...iris.dataset.iris], g = $(".iris__glyph", iris), strip = $$(".iris__strip span");
    let i = 0;
    const mark = () => strip.forEach((s, k) => s.classList.toggle("is-on", k === i));
    mark();
    if (!still) setInterval(() => {
      iris.classList.add("is-closed");
      setTimeout(() => { i = (i + 1) % glyphs.length; g.textContent = glyphs[i]; mark(); iris.classList.remove("is-closed"); }, 600);
    }, 1800);
  }

  // Chronolith: hover or press a key to see its mark large
  $$(".kb__key").forEach((k) => {
    const show = () => {
      $$(".kb__key.is-on").forEach((x) => x.classList.remove("is-on")); k.classList.add("is-on");
      $(".kb__big").textContent = k.dataset.glyph; $(".kb__which").textContent = k.dataset.key;
    };
    k.addEventListener("mouseenter", show); k.addEventListener("focus", show); k.addEventListener("click", show);
  });

  // Culvert: legend pieces insert into the Waterways plan; cut toggle for the width rows
  const map = $(".ww__map");
  $$(".ww__key").forEach((k) => k.addEventListener("click", () => {
    const s = map.selectionStart, e = map.selectionEnd;
    map.setRangeText(k.dataset.ch, s, e, "end"); map.focus();
  }));
  $$(".cv__toggle button").forEach((b) => b.addEventListener("click", () => {
    $$(".cv__toggle button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $$(".cv__row").forEach((r) => {
      const w = $(".cv__w", r), base = r.dataset.cut;   // Regular | Wide | Ultra
      const relief = b.dataset.cut === "relief";
      w.style.fontFamily = `'Culvert ${relief ? (base === "Regular" ? "Relief" : base + " Relief") : base}'`;
      w.textContent = b.dataset.cut === "solid" ? w.dataset.solid : w.dataset.inline;
    });
    document.fonts.ready.then(shrink);
  }));

  // Trapu: swash S on stylistic set 1
  const ss = $("[data-ss01]");
  ss?.addEventListener("click", () => {
    const on = ss.getAttribute("aria-pressed") !== "true";
    ss.setAttribute("aria-pressed", String(on)); $(".cuts").classList.toggle("ss01", on); shrink();
  });
})();
