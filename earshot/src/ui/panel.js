// The interface layer. Precise, restrained, and entirely driven by data —
// nothing on this page moves unless somewhere in the world moved first.

import { PATTERNS } from '../analysis/patterns.js';
import { LOCUS_CREDIT as LOCUS } from '../audio/sources.js';
import { formatClock, clamp } from '../core/util.js';

const BOOT_STEPS = [
  ['context',   'Audio context',     'interactive latency, native sample rate'],
  ['registry',  'Open microphones',  'ask the soundmap which are live right now'],
  ['selection', 'Selection',         'furthest apart wins — continents, not one city'],
  ['connect',   'Connections',       'open each stream and wait for real audio'],
  ['channels',  'Channels',          'one layer and one spectrogram per place'],
  ['analysis',  'Spectrogram',       '96 log bands · 45 Hz–16 kHz · 30 fps'],
  ['patterns',  'Reference library', `${PATTERNS.length} shapes, described not recorded`],
  ['orchestra', 'Orchestration',     'associative layer on, motif memory empty'],
  ['visual',    'Visualiser',        'stacked layers, chords between places'],
];

const STATE_MARK = { connecting: '·', live: '●', stalled: '◐', failed: '○' };

export class Panel {
  constructor({ onStart }) {
    this.onStart = onStart;
    this.el = {
      boot: document.getElementById('boot'),
      bootList: document.getElementById('boot-steps'),
      bootStatus: document.getElementById('boot-status'),
      start: document.getElementById('start'),
      sources: document.getElementById('sources'),
      library: document.getElementById('library'),
      figures: document.getElementById('figures'),
      motifs: document.getElementById('motifs'),
      act: document.getElementById('act'),
      credits: document.getElementById('credits'),
      spread: document.getElementById('spread'),
      tension: document.getElementById('tension-fill'),
      clock: document.getElementById('clock'),
      voices: document.getElementById('voices'),
      warning: document.getElementById('warning'),
    };
    this.steps = new Map();
    this.channelRows = [];
    this.libraryRows = new Map();
    this.buildBoot();
    this.buildLibrary();
    this.el.start.addEventListener('click', () => this.onStart());
    // Wired here, invoked by whoever owns the library.
    this.onLibraryOpen = null;
    this.onRemoveChannel = null;
    this.onMixerOpen = null;
    this.el.mixerOpen = document.getElementById('mixer-open');
    this.el.mixerOpen?.addEventListener('click', () => this.onMixerOpen?.());

    // Narration is a panel now, not a permanent rail: the stage gets the room.
    this.el.narration = document.getElementById('narration');
    this.el.narrationCount = document.getElementById('narration-count');
    document.getElementById('narration-open')?.addEventListener('click', () => this.toggleNarration());
    document.getElementById('narration-close')?.addEventListener('click', () => this.toggleNarration(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.narration.hidden) this.toggleNarration(false);
    });
    this.el.narration.addEventListener('click', (e) => {
      if (e.target === this.el.narration) this.toggleNarration(false);
    });
    this.entryCount = 0;
    this.unread = 0;
    this.el.libraryOpen = document.getElementById('locations-open');
    this.el.libraryOpen?.addEventListener('click', () => this.onLibraryOpen?.());
  }

  buildBoot() {
    for (const [key, title, note] of BOOT_STEPS) {
      const li = document.createElement('li');
      li.className = 'boot__step';
      li.dataset.state = 'pending';
      li.innerHTML = `
        <span class="boot__mark" aria-hidden="true"></span>
        <span class="boot__title">${title}</span>
        <span class="boot__note">${note}</span>`;
      this.el.bootList.appendChild(li);
      this.steps.set(key, li);
    }
  }

  buildLibrary() {
    for (const p of PATTERNS) {
      const li = document.createElement('li');
      li.className = 'library__row';
      li.innerHTML = `<span class="library__name">${p.short}</span><span class="library__bar"><i></i></span>`;
      this.el.library.appendChild(li);
      this.libraryRows.set(p.id, li.querySelector('i'));
    }
  }

  step(key, state, note) {
    const li = this.steps.get(key);
    if (!li) return;
    li.dataset.state = state;
    if (note) li.querySelector('.boot__note').textContent = note;
  }

  bootStatus(text) {
    this.el.bootStatus.textContent = text;
  }

  startable(label = 'Begin listening') {
    this.el.start.textContent = label;
    this.el.start.hidden = false;
    this.el.start.disabled = false;
  }

  hideStart() {
    this.el.start.hidden = true;
  }

  hideBoot() {
    this.el.boot.dataset.state = 'done';
    setTimeout(() => { this.el.boot.hidden = true; }, 900);
  }

  fail(message) {
    this.el.boot.dataset.state = 'failed';
    this.bootStatus(message);
    this.startable('Try again');
  }

  warn(text) {
    this.el.warning.textContent = text || '';
    this.el.warning.hidden = !text;
  }

  setChannels(channels) {
    this.el.sources.innerHTML = '';
    this.channelRows = channels.map((ch) => {
      const m = ch.meta ?? {};
      const li = document.createElement('li');
      li.className = 'source';
      li.dataset.state = ch.stream?.state ?? 'live';
      li.innerHTML = `
        <span class="source__swatch" style="background:${rgbCss(ch.ink.rgb)}"></span>
        <span class="source__name">${escape(m.city ? m.city : ch.name)}</span>
        <span class="source__state" title="stream state"></span>
        <span class="source__where">${escape(m.country || (m.remote ? '' : 'local input'))}${
          Number.isFinite(m.lat) ? ` · ${m.lat.toFixed(1)}, ${m.lng.toFixed(1)}` : ''}</span>
        <button class="source__off" type="button" title="take ${escape(m.place ?? ch.name)} off">off</button>
        <span class="source__meter"><i></i></span>
        <b class="source__trim"></b>`;
      this.el.sources.appendChild(li);
      // Turning a place off from the main screen, without opening the library.
      li.querySelector('.source__off').addEventListener('click', () => {
        this.onRemoveChannel?.(ch);
      });
      const row = {
        el: li,
        fill: li.querySelector('.source__meter i'),
        state: li.querySelector('.source__state'),
        trim: li.querySelector('.source__trim'),
      };
      this.setChannelState(channels.indexOf(ch), li.dataset.state, '', row);
      return row;
    });
    // With one place left there is nothing to fall back to, so do not offer it.
    const removable = channels.length > 1;
    this.channelRows.forEach((row) => {
      row.el.querySelector('.source__off').hidden = !removable;
    });
    this.setCredits(channels);
  }

  /** Stream health, shown honestly: a quiet mic is live, not broken. */
  setChannelState(index, state, detail = '', rowOverride = null) {
    const row = rowOverride ?? this.channelRows[index];
    if (!row) return;
    row.el.dataset.state = state;
    row.state.textContent = STATE_MARK[state] ?? '·';
    row.state.title = detail ? `${state} — ${detail}` : state;
  }

  /** The mics belong to the people who installed them. Say so, always. */
  setCredits(channels) {
    if (!this.el.credits) return;
    const people = [...new Set(channels.map((c) => c.meta?.artist).filter(Boolean))];
    const rows = people.map((name) => `<li class="credit">${escape(name)}</li>`);
    rows.push(`<li class="credit credit--source"><a href="${LOCUS.url}" target="_blank" rel="noreferrer noopener">${escape(LOCUS.name)}</a></li>`);
    this.el.credits.innerHTML = rows.join('');
  }

  setSpread(km) {
    if (!this.el.spread) return;
    this.el.spread.textContent = km >= 1000
      ? `${(km / 1000).toFixed(1).replace(/\.0$/, '')}k km`
      : `${Math.round(km)} km`;
  }

  updateMeters(channels) {
    for (let i = 0; i < this.channelRows.length && i < channels.length; i++) {
      const ch = channels[i];
      const row = this.channelRows[i];
      row.fill.style.transform = `scaleX(${clamp(ch.level * 2.4, 0, 1).toFixed(3)})`;

      // Show the adaptive trim once it is doing real work, so a quiet place
      // looking active is explained rather than mysterious.
      const gain = ch.spectrogram?.gain ?? 1;
      row.trim.textContent = gain > 1.5 ? `${gain.toFixed(1)}×` : '';
      // And in full on hover: three separate things are done to a quiet place, and
      // a listener is owed the chance to know which.
      row.trim.title = describeNormalisation(ch);
    }
  }

  /** Reflect capacity on the library trigger rather than failing on click. */
  setCapacity(atCapacity) {
    if (this.el.mixerOpen) this.el.mixerOpen.disabled = false;
    if (!this.el.libraryOpen) return;
    this.el.libraryOpen.disabled = false;
    this.el.libraryOpen.textContent = atCapacity ? 'library · full' : 'library';
  }

  /** Light the matched entry in the library at the confidence it was matched with. */
  markPattern(id, confidence) {
    const bar = this.libraryRows.get(id);
    if (!bar) return;
    bar.style.transform = `scaleX(${clamp(confidence, 0, 1).toFixed(3)})`;
    bar.parentElement.parentElement.dataset.hit = '1';
    clearTimeout(bar._t);
    bar._t = setTimeout(() => {
      bar.style.transform = 'scaleX(0)';
      bar.parentElement.parentElement.dataset.hit = '0';
    }, 2400);
  }

  toggleNarration(force = null) {
    const show = force ?? this.el.narration.hidden;
    this.el.narration.hidden = !show;
    if (show) this.unread = 0;
    this.refreshNarrationLabel();
  }

  refreshNarrationLabel() {
    const button = document.getElementById('narration-open');
    if (!button) return;
    button.textContent = this.unread ? `narration · ${this.unread}` : 'narration';
    if (this.el.narrationCount) {
      this.el.narrationCount.textContent = `${this.entryCount} entr${this.entryCount === 1 ? 'y' : 'ies'}`;
    }
  }

  addEntry(entry, startedMs) {
    const li = document.createElement('li');
    li.className = `figure figure--${entry.kind}`;
    const stamp = formatClock(Math.max(0, entry.timeMs - startedMs));
    li.innerHTML = `<span class="figure__time">${stamp}</span><span class="figure__text">${escape(entry.text)}</span>`;
    this.el.figures.prepend(li);
    while (this.el.figures.children.length > 60) {
      this.el.figures.removeChild(this.el.figures.lastChild);
    }
    this.entryCount++;
    // With the panel closed, say how much has been written rather than pulling
    // attention away from the stage.
    if (this.el.narration.hidden) this.unread++;
    this.refreshNarrationLabel();
  }

  setMotifs(motifs) {
    const rows = motifs.slice(0, 10);
    this.el.motifs.innerHTML = rows.map((m) => `
      <li class="motif">
        <span class="motif__name">${escape(m.name)}</span>
        <span class="motif__count">${m.count}${m.returns ? `·${m.returns}` : ''}</span>
      </li>`).join('') || '<li class="motif motif--empty">nothing has repeated yet</li>';
  }

  setStatus({ act, tension, elapsedMs, voices, ducking }) {
    this.el.act.textContent = act;
    this.el.tension.style.transform = `scaleX(${clamp(tension, 0, 1).toFixed(3)})`;
    this.el.clock.textContent = formatClock(elapsedMs);
    this.el.voices.textContent = String(voices).padStart(2, '0');
    document.body.dataset.ducking = ducking ? '1' : '0';
  }
}

/**
 * What has been done to make this place comparable to the others, in plain words.
 *
 * Three different adjustments, each with its own reason, and it should be possible
 * to find out which of them is holding a quiet place up.
 */
export function describeNormalisation(channel) {
  const sg = channel.spectrogram ?? {};
  const parts = [];
  const floor = sg.floorOffsetDb ?? 0;
  const gain = sg.gain ?? 1;
  const match = channel.strip?.matchDb ?? 0;
  if (floor <= -1) parts.push(`window ${Math.round(-floor)} dB lower than usual — a quiet place`);
  if (gain > 1.05 || gain < 0.95) parts.push(`plot ×${gain.toFixed(2)}`);
  if (Math.abs(match) >= 0.5) parts.push(`heard ${match > 0 ? '+' : ''}${match.toFixed(1)} dB`);
  return parts.length ? parts.join(' · ') : 'nothing adjusted — this place arrives at level';
}

function rgbCss([r, g, b]) {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

function escape(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
