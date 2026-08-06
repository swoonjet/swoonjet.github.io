// The library of places.
//
// Every microphone the soundmap says is live, as an index you can read and
// search: grouped by country, with the artist who installed it and how far it is
// from what you are already listening to. What is playing is pinned to the top,
// so the thing you most often want — take that one off — is never buried in a
// list of fifty.
//
// Clicking a row swaps it into the piece immediately. No apply step, no dialog.

import { haversineKm } from '../audio/sources.js';
import { CONFIG } from '../core/config.js';

export class Locations {
  constructor({ onToggle, onRandom, onClose }) {
    this.onToggle = onToggle;
    this.onRandom = onRandom;
    this.onClose = onClose;

    this.sources = [];
    this.groups = [];
    this.rows = new Map();
    this.unavailable = new Set();
    this.query = '';

    this.el = document.getElementById('locations');
    this.listEl = document.getElementById('locations-list');
    this.playingEl = document.getElementById('locations-playing');
    this.countEl = document.getElementById('locations-count');
    this.hintEl = document.getElementById('locations-hint');
    this.searchEl = document.getElementById('locations-search');
    this.emptyEl = document.getElementById('locations-empty');

    document.getElementById('locations-close').addEventListener('click', () => this.close());
    document.getElementById('locations-random').addEventListener('click', () => this.onRandom());

    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value.trim().toLowerCase();
      this.applyFilter();
    });

    // Escape closes it, or clears the search first. A panel with no way back is a trap.
    this.onKey = (e) => {
      if (e.key !== 'Escape' || !this.isOpen) return;
      if (this.query) { this.searchEl.value = ''; this.query = ''; this.applyFilter(); }
      else this.close();
    };
    document.addEventListener('keydown', this.onKey);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
  }

  get isOpen() {
    return !this.el.hidden;
  }

  /**
   * Live places first, then the archive — each grouped by country.
   *
   * Sorting the whole list by country was right when it held 48 live microphones
   * and wrong the moment the archive arrived: 48 awake places scattered through
   * 1,267 dead ones across a hundred headings is not a library, it is a haystack,
   * and the top of the list became a wall of things that cannot be listened to.
   */
  setSources(sources) {
    const byPlace = (a, b) =>
      (a.country || 'zzz').localeCompare(b.country || 'zzz') || a.city.localeCompare(b.city);
    const live = sources.filter((s) => s.live !== false).sort(byPlace);
    const archive = sources.filter((s) => s.live === false).sort(byPlace);
    this.liveCount = live.length;
    this.sources = [...live, ...archive];
    this.build();
  }

  /** A stream that refused to open is shown as unavailable, not offered again. */
  markUnavailable(source, reason = 'would not open') {
    this.unavailable.add(source.id);
    const row = this.rows.get(source.id);
    if (row) {
      row.dataset.unavailable = '1';
      row.title = `${source.place} — ${reason}`;
    }
  }

  clearUnavailable(source) {
    this.unavailable.delete(source.id);
    const row = this.rows.get(source.id);
    if (row) row.dataset.unavailable = '0';
  }

  build() {
    this.listEl.innerHTML = '';
    this.rows.clear();
    this.groups = [];

    let group = null;
    let section = null;
    this.sections = [];
    for (const source of this.sources) {
      // Two sections, each grouped by country. The country heading repeats in the
      // archive on purpose — it belongs to its section, not to the page.
      const isLive = source.live !== false;
      if (section === null || section.live !== isLive) {
        const sectionEl = document.createElement('div');
        sectionEl.className = 'locations__section';
        sectionEl.textContent = isLive
          ? `live now · ${this.liveCount}`
          : `the archive · ${this.sources.length - this.liveCount} places, none of them live`;
        this.listEl.appendChild(sectionEl);
        section = { live: isLive, el: sectionEl, groups: [] };
        this.sections.push(section);
        group = null;
      }
      const country = source.country || 'elsewhere';
      if (!group || group.country !== country) {
        const headEl = document.createElement('div');
        headEl.className = 'locations__country';
        headEl.textContent = country;
        this.listEl.appendChild(headEl);
        group = { country, headEl, entries: [] };
        this.groups.push(group);
        section.groups.push(group);
      }
      const row = this.makeRow(source);
      this.listEl.appendChild(row);
      this.rows.set(source.id, row);
      group.entries.push({ source, row });
    }
  }

  makeRow(source) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'location';
    row.dataset.id = source.id;
    // Archive places are shown and can be tried; they are simply not pretended to
    // be awake, and the selection never reaches for them.
    if (source.live === false) row.dataset.archive = '1';
    row.innerHTML = `
      <span class="location__mark" aria-hidden="true"></span>
      <span class="location__city">${escape(source.city)}</span>
      <span class="location__detail">${escape(source.detail || '')}</span>
      <span class="location__artist">${escape(source.artist || '—')}</span>
      <span class="location__distance"></span>`;
    if (source.live === false) {
      row.querySelector('.location__artist').textContent += ' · not live now';
    }
    row.addEventListener('click', () => this.onToggle(source));
    return row;
  }

  applyFilter() {
    const q = this.query;
    let shown = 0;
    for (const group of this.groups) {
      let visibleInGroup = 0;
      for (const { source, row } of group.entries) {
        const hay = `${source.city} ${source.country} ${source.detail} ${source.artist}`.toLowerCase();
        const match = !q || hay.includes(q);
        row.hidden = !match;
        if (match) { visibleInGroup++; shown++; }
      }
      group.headEl.hidden = visibleInGroup === 0;
    }
    // A section with nothing left in it should not sit there labelling emptiness.
    for (const sec of this.sections ?? []) {
      sec.el.hidden = sec.groups.every((g) => g.headEl.hidden);
    }
    this.emptyEl.hidden = shown > 0;
    if (!shown) this.emptyEl.textContent = `Nothing matches "${this.searchEl.value}".`;
    return shown;
  }

  /** Reflect what is currently playing, in the list and in the pinned block. */
  update(channels) {
    const playing = new Map(channels.map((c) => [c.meta?.sourceId, c]));
    const atCapacity = channels.length >= Math.min(CONFIG.sources.max, 6);
    const anchors = channels.map((c) => c.meta).filter((m) => Number.isFinite(m?.lat));

    for (const source of this.sources) {
      const row = this.rows.get(source.id);
      if (!row) continue;
      const channel = playing.get(source.id);
      const on = Boolean(channel);
      const blocked = this.unavailable.has(source.id);

      row.dataset.on = on ? '1' : '0';
      row.dataset.unavailable = blocked ? '1' : '0';
      row.disabled = !on && (atCapacity || blocked);
      row.title = on
        ? `listening — click to remove ${source.place}`
        : blocked
          ? `${source.place} would not open`
          : atCapacity
            ? `at capacity (${CONFIG.sources.max}) — remove one to add another`
            : `click to add ${source.place}`;

      if (on) row.style.setProperty('--row-ink', rgbCss(channel.ink.rgb));
      else row.style.removeProperty('--row-ink');

      const near = anchors.length && !on
        ? Math.min(...anchors.map((m) => haversineKm(source, m)))
        : null;
      row.querySelector('.location__distance').textContent =
        on ? 'live' : near == null ? '' : `+${formatKm(near)}`;
    }

    this.renderPlaying(channels);
    // It said "1315 live", which was a lie by a factor of twenty-seven.
    this.countEl.textContent = `${this.liveCount} live · ${this.sources.length} in the archive`
      + ` · ${channels.length} playing`;
    this.hintEl.textContent = atCapacity
      ? `At capacity. Take one off to add another.`
      : `Click a place to add it. Click a live one to take it off.`;
    this.applyFilter();
  }

  /** The set currently playing, pinned above the index. */
  renderPlaying(channels) {
    this.playingEl.innerHTML = channels.map((c) => {
      const m = c.meta ?? {};
      return `<button type="button" class="playing" data-id="${escape(m.sourceId ?? '')}"
        title="click to take ${escape(m.place ?? m.name)} off"
        style="--row-ink:${rgbCss(c.ink.rgb)}">
        <span class="playing__mark" aria-hidden="true"></span>
        <span class="playing__city">${escape(m.city ?? c.name)}</span>
        <span class="playing__country">${escape(m.country ?? '')}</span>
        <span class="playing__off" aria-hidden="true">take off</span>
      </button>`;
    }).join('');

    for (const button of this.playingEl.querySelectorAll('.playing')) {
      const source = this.sources.find((s) => s.id === button.dataset.id)
        ?? channels.find((c) => c.meta?.sourceId === button.dataset.id)?.meta;
      if (source) button.addEventListener('click', () => this.onToggle(source));
    }
  }

  open() {
    this.el.hidden = false;
    this.el.dataset.state = 'open';
    this.searchEl.focus();
  }

  close() {
    this.el.dataset.state = 'closed';
    this.el.hidden = true;
    this.onClose?.();
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }
}

function formatKm(km) {
  return km >= 1000 ? `${Math.round(km / 100) / 10}k km` : `${Math.round(km)} km`;
}

function rgbCss([r, g, b]) {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
