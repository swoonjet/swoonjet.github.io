// The view menu.
//
// This replaces a button that cycled. Cycling is the cheapest control to build and
// the worst to use: it names where you will end up rather than where you can go,
// it cannot tell you what any of the choices are, and reaching the third of three
// means passing through the second. Three named readings, each with a line saying
// what it is, all one keystroke away.
//
// The number keys work whether the menu is open or not, so nobody has to open a
// menu twice to compare two readings.

import { VIEWS, viewById, viewByKey, nextView } from './views.js';

export class ViewMenu {
  constructor({ onSelect }) {
    this.onSelect = onSelect;
    this.activeId = VIEWS[0].id;

    this.el = document.getElementById('view-menu');
    this.listEl = document.getElementById('view-menu-list');
    this.button = document.getElementById('view-open');

    this.build();
    this.button?.addEventListener('click', () => this.toggle());

    // Clicking anywhere else closes it. Captured on the document, so a click on
    // the stage both closes the menu and reaches the stage.
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.el.contains(e.target) && e.target !== this.button) this.close();
    });

    document.addEventListener('keydown', (e) => this.onKey(e));
    this.setActive(this.activeId);
  }

  get isOpen() { return this.el && !this.el.hidden; }

  build() {
    if (!this.listEl) return;
    this.rows = new Map();
    for (const view of VIEWS) {
      const li = document.createElement('li');
      li.className = 'viewrow';
      li.innerHTML = `
        <button class="viewrow__button" type="button" role="menuitemradio">
          <span class="viewrow__mark" aria-hidden="true"></span>
          <span class="viewrow__key">${view.key}</span>
          <span class="viewrow__name">${view.name}</span>
          <span class="viewrow__blurb">${view.blurb}</span>
        </button>`;
      li.querySelector('button').addEventListener('click', () => {
        this.select(view.id);
        this.close();
      });
      this.listEl.appendChild(li);
      this.rows.set(view.id, li);
    }
  }

  /**
   * Number keys pick a reading, `v` opens the menu, Escape closes it. Never while
   * something is being typed into, and never on top of a shortcut the browser or
   * the operating system already owns.
   */
  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    if (e.key === 'Escape' && this.isOpen) { this.close(); return; }
    const byKey = viewByKey(e.key);
    if (byKey) {
      e.preventDefault();
      this.select(byKey.id);
      this.close();
      return;
    }
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      this.toggle();
    }
  }

  select(id) {
    if (id === this.activeId) return;
    this.setActive(id);
    this.onSelect?.(id);
  }

  /** Also called from outside, so the menu cannot disagree with the stage. */
  setActive(id) {
    this.activeId = id;
    for (const [viewId, li] of this.rows ?? []) {
      const on = viewId === id;
      li.dataset.active = on ? '1' : '0';
      li.querySelector('button')?.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    // The control says what is on the stage now. What comes next is the menu's job.
    if (this.button) this.button.textContent = `view · ${viewById(id).name}`;
  }

  /** For anyone who wants the old behaviour: one step along the list. */
  cycle() { this.select(nextView(this.activeId)); }

  open() {
    if (!this.el) return;
    this.el.hidden = false;
    this.button?.setAttribute('aria-expanded', 'true');
  }

  close() {
    if (!this.el) return;
    this.el.hidden = true;
    this.button?.setAttribute('aria-expanded', 'false');
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }
}
