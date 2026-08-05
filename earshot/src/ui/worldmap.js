// Where the piece is listening, on one small map.
//
// Every live microphone is a faint mark; the ones currently playing are drawn in
// their channel's ink and joined to each other, so the spread the selection works
// so hard to maximise is visible rather than merely asserted. Equirectangular,
// because this is a diagram of relative position, not a navigational chart.

import { WORLD_PATH, WORLD_VIEWBOX, project } from '../visual/world-path.js';

export class WorldMap {
  constructor(el) {
    this.el = el;
    this.sources = [];
    this.el.innerHTML = `
      <svg class="map__svg" viewBox="0 0 ${WORLD_VIEWBOX.width} ${WORLD_VIEWBOX.height}"
           preserveAspectRatio="xMidYMid meet" role="img" aria-label="Locations of the live microphones">
        <path class="map__land" d="${WORLD_PATH}" />
        <g class="map__links"></g>
        <g class="map__all"></g>
        <g class="map__live"></g>
      </svg>`;
    this.svg = this.el.querySelector('svg');
    this.linksEl = this.el.querySelector('.map__links');
    this.allEl = this.el.querySelector('.map__all');
    this.liveEl = this.el.querySelector('.map__live');
  }

  /** Every microphone the soundmap is offering, as faint marks. */
  setSources(sources) {
    this.sources = sources;
    this.allEl.innerHTML = sources.map((s) => {
      const [x, y] = project(s.lng, s.lat);
      return `<circle class="map__dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4"><title>${escape(s.place)}</title></circle>`;
    }).join('');
  }

  /** The set currently playing, in their channel inks, joined up. */
  setActive(channels) {
    const points = channels
      .map((c) => ({ meta: c.meta, ink: c.ink }))
      .filter((c) => Number.isFinite(c.meta?.lat))
      .map((c) => ({ ...c, xy: project(c.meta.lng, c.meta.lat) }));

    // Join every pair. On an equirectangular plot a straight line is not a great
    // circle, but this is a diagram of how far apart the sources are, and a
    // straight line says that plainly.
    const links = [];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const [x1, y1] = points[i].xy;
        const [x2, y2] = points[j].xy;
        links.push(`<line class="map__link" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`);
      }
    }
    this.linksEl.innerHTML = links.join('');

    this.liveEl.innerHTML = points.map(({ meta, ink, xy }) => {
      const [x, y] = xy;
      const c = rgbCss(ink.rgb);
      return `<g class="map__mark">
        <circle class="map__halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${c}" />
        <rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" fill="${c}" />
        <title>${escape(meta.place ?? meta.name)}</title>
      </g>`;
    }).join('');
  }
}

function rgbCss([r, g, b]) {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

function escape(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
