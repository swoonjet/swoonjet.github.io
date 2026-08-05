// The mixer panel.
//
// One strip per place, plus a master strip. Controls are labelled with what they
// do to the *place*, not with signal-processing terms, because that is what the
// listener is moving: "low cut" removes the wind and the traffic rumble a field
// microphone always has; "tone" takes the top off a hissy stream; "space" sends
// it into the same generated room the piece's own layers live in.

import { CONFIG } from '../core/config.js';
import { panByLongitude, MIXER_DEFAULTS } from '../audio/mixer.js';
import { clamp } from '../core/util.js';

const CONTROLS = [
  { key: 'level',    label: 'level', min: 0,   max: 1.5,  step: 0.01, fmt: (v) => `${Math.round(v * 100)}` },
  { key: 'pan',      label: 'pan',   min: -1,  max: 1,    step: 0.02, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`) },
  { key: 'lowcutHz', label: 'low cut', min: MIXER_DEFAULTS.OFF_LOWCUT, max: 600, step: 1, log: true, fmt: (v) => (v <= MIXER_DEFAULTS.OFF_LOWCUT + 0.5 ? 'off' : `${Math.round(v)}`) },
  { key: 'toneHz',   label: 'tone',  min: 500, max: MIXER_DEFAULTS.OFF_TONE, step: 1, log: true, fmt: (v) => (v >= MIXER_DEFAULTS.OFF_TONE - 0.5 ? 'off' : `${(v / 1000).toFixed(1)}k`) },
  { key: 'reverb',   label: 'space', min: 0,   max: 1,    step: 0.01, fmt: (v) => `${Math.round(v * 100)}` },
];

export class MixerPanel {
  constructor({ onChange }) {
    this.onChange = onChange;
    this.channels = [];
    this.strips = new Map();

    this.el = document.getElementById('mixer');
    this.listEl = document.getElementById('mixer-strips');
    this.countEl = document.getElementById('mixer-count');

    document.getElementById('mixer-close').addEventListener('click', () => this.close());

    // Level matching is the engine's, not a strip's, so it belongs up here with
    // the other things that apply to the whole set.
    this.matchEl = document.getElementById('mixer-match');
    this.matchEl?.addEventListener('click', () => {
      const cfg = CONFIG.audio.levelMatch;
      cfg.enabled = !cfg.enabled;
      // Off means back to unity on every strip, not frozen wherever it happened
      // to be — the engine does that on its next frame.
      this.refresh();
      this.onChange?.(cfg.enabled
        ? 'matching levels — the quiet places are lifted toward the loud ones'
        : 'level matching off — the set as it really arrives');
    });

    document.getElementById('mixer-geo').addEventListener('click', () => {
      const n = panByLongitude(this.channels);
      this.refresh();
      this.onChange?.(`panned ${n} places by longitude`);
    });
    document.getElementById('mixer-flat').addEventListener('click', () => {
      for (const c of this.channels) c.strip?.reset();
      this.onChange?.('mixer reset');
      this.refresh();
    });

    this.balanceEl = document.getElementById('mixer-balance');
    this.balanceOutEl = document.getElementById('mixer-balance-value');
    this.balanceEl.addEventListener('input', () => this.applyBalance());

    this.masterEl = document.getElementById('mixer-master');
    this.masterOutEl = document.getElementById('mixer-master-value');
    this.masterEl.addEventListener('input', () => this.applyMaster());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
  }

  get isOpen() { return !this.el.hidden; }

  attach(engine) {
    this.engine = engine;
    this.balanceEl.value = String(balanceToSlider(
      engine.worldBus.gain.value, engine.responseBus.gain.value));
    this.masterEl.value = String(engine.master.gain.value);
    this.applyBalance(true);
    this.applyMaster(true);
  }

  /** The world/response balance as one control: left is the world, right is the reply. */
  applyBalance(quiet = false) {
    const t = Number(this.balanceEl.value);
    const world = CONFIG.audio.liveMixGain * (1 - t) * 2;
    const response = CONFIG.audio.responseGain * t * 2;
    this.engine?.setBalance(clamp(world, 0, 2), clamp(response, 0, 2));
    const pct = Math.round(t * 100);
    this.balanceOutEl.textContent = `${100 - pct} world / ${pct} reply`;
    if (!quiet) this.onChange?.(null);
  }

  applyMaster(quiet = false) {
    const v = Number(this.masterEl.value);
    if (this.engine) {
      this.engine.master.gain.setTargetAtTime(v, this.engine.ctx.currentTime, 0.05);
      // Keep the feedback watchdog's recovery target honest.
      CONFIG.safety.masterGain = v;
    }
    this.masterOutEl.textContent = String(Math.round(v * 100));
    if (!quiet) this.onChange?.(null);
  }

  setChannels(channels) {
    this.channels = channels;
    this.listEl.innerHTML = '';
    this.strips.clear();

    for (const channel of channels) {
      const strip = document.createElement('div');
      strip.className = 'strip';
      strip.innerHTML = `
        <header class="strip__head">
          <span class="strip__swatch" style="background:${rgbCss(channel.ink.rgb)}"></span>
          <span class="strip__name">${escape(channel.meta?.city ?? channel.name)}</span>
          <span class="strip__place">${escape(channel.meta?.country ?? '')}</span>
          <span class="strip__match" title="level matching, applied upstream of this fader"></span>
          <span class="strip__meter"><i></i></span>
        </header>
        <div class="strip__buttons">
          <button type="button" class="toggle" data-act="muted">mute</button>
          <button type="button" class="toggle" data-act="soloed">solo</button>
        </div>
        <div class="strip__controls"></div>`;

      const controlsEl = strip.querySelector('.strip__controls');
      const rows = new Map();
      for (const spec of CONTROLS) {
        const row = document.createElement('label');
        row.className = 'ctl';
        row.innerHTML = `
          <span class="ctl__label">${spec.label}</span>
          <input class="ctl__range" type="range" min="0" max="1" step="0.001">
          <span class="ctl__value"></span>`;
        const range = row.querySelector('.ctl__range');
        range.addEventListener('input', () => {
          channel.strip?.set(spec.key, fromSlider(spec, Number(range.value)));
          this.engine?.applyMix();
          this.refreshStrip(channel);
          this.onChange?.(null);
        });
        controlsEl.appendChild(row);
        rows.set(spec.key, { row, range, value: row.querySelector('.ctl__value') });
      }

      for (const button of strip.querySelectorAll('.toggle')) {
        button.addEventListener('click', () => {
          const key = button.dataset.act;
          channel.strip?.set(key, !channel.strip.state[key]);
          this.engine?.applyMix();
          this.refresh();
          this.onChange?.(null);
        });
      }

      this.listEl.appendChild(strip);
      this.strips.set(channel.id, {
        el: strip,
        rows,
        meter: strip.querySelector('.strip__meter i'),
        match: strip.querySelector('.strip__match'),
        buttons: strip.querySelectorAll('.toggle'),
      });
    }
    this.refresh();
  }

  refresh() {
    const soloActive = this.channels.some((c) => c.strip?.state.soloed);
    for (const channel of this.channels) this.refreshStrip(channel, soloActive);
    this.countEl.textContent = `${this.channels.length} place${this.channels.length === 1 ? '' : 's'}`
      + (soloActive ? ' · solo' : '');
    if (this.matchEl) this.matchEl.dataset.on = CONFIG.audio.levelMatch.enabled ? '1' : '0';
  }

  refreshStrip(channel, soloActive = null) {
    const ui = this.strips.get(channel.id);
    const strip = channel.strip;
    if (!ui || !strip) return;
    const solo = soloActive ?? this.channels.some((c) => c.strip?.state.soloed);

    for (const spec of CONTROLS) {
      const row = ui.rows.get(spec.key);
      const value = strip.state[spec.key];
      row.range.value = String(toSlider(spec, value));
      row.value.textContent = spec.fmt(value);
      row.row.dataset.active = value !== defaultFor(spec) ? '1' : '0';
    }
    for (const button of ui.buttons) {
      button.dataset.on = strip.state[button.dataset.act] ? '1' : '0';
    }
    // A strip silenced by someone else's solo should look silenced.
    const audible = !strip.state.muted && (!solo || strip.state.soloed);
    ui.el.dataset.silent = audible ? '0' : '1';
  }

  updateMeters() {
    const matching = CONFIG.audio.levelMatch.enabled;
    for (const channel of this.channels) {
      const ui = this.strips.get(channel.id);
      if (!ui) continue;
      ui.meter.style.transform = `scaleX(${clamp((channel.level ?? 0) * 2.4, 0, 1).toFixed(3)})`;
      // Say what the match is doing, in dB, while it is doing it. A gain that
      // moves on its own and cannot be seen is the thing people rightly distrust.
      const db = channel.strip?.matchDb ?? 0;
      ui.match.textContent = matching && Math.abs(db) >= 0.5
        ? `${db > 0 ? '+' : ''}${db.toFixed(1)}`
        : '';
    }
  }

  open() { this.el.hidden = false; this.refresh(); }
  close() { this.el.hidden = true; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
}

/** Sliders are all 0..1; frequency controls are logarithmic so the useful end is usable. */
function toSlider(spec, value) {
  if (spec.log) {
    const lo = Math.log(spec.min), hi = Math.log(spec.max);
    return (Math.log(clamp(value, spec.min, spec.max)) - lo) / (hi - lo);
  }
  return (clamp(value, spec.min, spec.max) - spec.min) / (spec.max - spec.min);
}

function fromSlider(spec, t) {
  if (spec.log) {
    const lo = Math.log(spec.min), hi = Math.log(spec.max);
    return Math.exp(lo + (hi - lo) * clamp(t, 0, 1));
  }
  return spec.min + (spec.max - spec.min) * clamp(t, 0, 1);
}

function defaultFor(spec) {
  return { level: 1, pan: 0, lowcutHz: MIXER_DEFAULTS.OFF_LOWCUT, toneHz: MIXER_DEFAULTS.OFF_TONE, reverb: 0.12 }[spec.key];
}

function balanceToSlider(world, response) {
  const total = world + response;
  return total > 0 ? clamp(response / total, 0, 1) : 0.5;
}

function rgbCss([r, g, b]) {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
