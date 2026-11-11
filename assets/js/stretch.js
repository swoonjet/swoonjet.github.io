// Masthead hover: the hovered item's letter-spacing opens up until its whole line meets the
// right edge of its grid cell, so the word stretches across the columns it sits on.
// Index rows do the same with their Field label whenever the row is hovered or focused.
(() => {
  const items = document.querySelectorAll(".masthead .stretch");
  const range = document.createRange();
  function open(el) {
    const cell = el.closest(".a, .b, .c, .i-field"), line = el.parentElement;
    if (!cell || getComputedStyle(cell).gridColumnStart === "1" && innerWidth < 640) return; // phones: cells are full width
    if (el.classList.contains("is-stretched")) return;
    // measure the line at rest: pause transitions so nothing mid-animation is counted
    const items = line.querySelectorAll(".stretch");
    items.forEach((i) => (i.style.transition = "none"));
    const was = [...items].map((i) => i.classList.contains("is-stretched"));
    items.forEach((i) => i.classList.remove("is-stretched"));
    range.selectNodeContents(line);
    const used = range.getBoundingClientRect().width;
    const room = cell.getBoundingClientRect().right - line.getBoundingClientRect().left - used;
    // last item on its line: spread over the gaps between letters so the final letter lands on
    // the column line; otherwise its trailing gap opens before the next item too
    const last = !el.nextElementSibling && !(el.nextSibling && el.nextSibling.textContent.trim());
    const gaps = el.textContent.length - (last ? 1 : 0);
    items.forEach((i, k) => { if (was[k] && i !== el) i.classList.add("is-stretched"); });
    void line.offsetWidth;                     // commit the resting values before re-enabling transitions
    items.forEach((i) => (i.style.transition = ""));
    if (room <= 0 || gaps < 1) return;
    el.style.setProperty("--stretch", (room / gaps - 0.1).toFixed(2) + "px");
    el.classList.add("is-stretched");
  }
  const close = (el) => el.classList.remove("is-stretched");
  items.forEach((el) => {
    el.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && open(el));
    el.addEventListener("pointerleave", () => close(el));
    el.addEventListener("focus", () => open(el));
    el.addEventListener("blur", () => close(el));
  });
  document.querySelectorAll(".row").forEach((row) => {
    const el = row.querySelector(".i-field .stretch");
    if (!el) return;
    row.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && open(el));
    row.addEventListener("pointerleave", () => close(el));
    row.addEventListener("focus", () => open(el));
    row.addEventListener("blur", () => close(el));
  });
})();
