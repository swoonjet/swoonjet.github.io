// Where the sound comes from.
//
// Locus Sonus runs a network of open microphones — permanently installed, openly
// streamed, scattered across the world. Its soundmap publishes which of them are
// live right now. That list is this piece's input: several of those mics at once,
// chosen to be as far apart as possible, so the collage is built from
// coincidences between places rather than between corners of one room.
//
// Both the list and the streams send Access-Control-Allow-Origin: *, which is
// what makes spectrogram analysis of them possible at all — without it the
// Web Audio graph would hand back silence.

export const LOCUS_ACTIVE_URL = 'https://locusonus.org/soundmap/list/active/json/name';
export const LOCUS_CREDIT = { name: 'Locus Sonus — open microphones', url: 'https://locusonus.org/soundmap/' };

/**
 * Verified live on 2026-08-05 and kept only for when the soundmap API cannot be
 * reached. The live list is always preferred: these mics come and go, and a
 * hard-coded stream is a stream that will eventually be a lie.
 */
export const FALLBACK_SOURCES = [
  { id: '296',  name: 'otsuchi — otohama',        url: 'http://mp3s.nc.u-tokyo.ac.jp/OTSUCHI_CyberForest.mp3',              ext: 'mp3', artist: 'grant',                       lat: 39.3514,  lng: 141.935,  city: 'otsuchi',       country: 'Japan' },
  { id: '3309', name: 'capitaloceno — lima',       url: 'https://locus.creacast.com:9443/capitaloceno_proyectoamil_lima_peru.mp3', ext: 'mp3', artist: 'pablo hare',            lat: -12.1415, lng: -77.0245, city: 'lima',          country: 'Peru' },
  { id: '246',  name: 'empordà — aiguamolls',      url: 'https://locus.creacast.com:9443/emporda_aiguamolls.mp3',           ext: 'mp3', artist: 'jordi giro quer',              lat: 42.2241,  lng: 3.09242,  city: 'empordà',       country: 'Catalunya' },
  { id: '274',  name: 'jasper ridge — birdcast',   url: 'https://locus.creacast.com:9443/jasper_ridge_birdcast.mp3',        ext: 'mp3', artist: 'Trevor Hebert',                lat: 37.4036,  lng: -122.238, city: 'jasper ridge',  country: 'United States' },
  { id: '3100', name: 'kerala — stream 083',       url: 'https://locus.creacast.com:9443/stream_083.mp3',                   ext: 'mp3', artist: 'grant',                        lat: 10.1151,  lng: 76.3852,  city: 'kerala',        country: 'India' },
  { id: '2882', name: 'peterborough — birdradio',  url: 'https://birdradio.ddns.net/birdradio',                             ext: 'ogg', artist: 'Dave Seidel',                  lat: 42.9314,  lng: -71.9231, city: 'peterborough',  country: 'United States' },
  { id: '2624', name: 'morelia — pueblito',        url: 'https://locus.creacast.com:9443/morelia_pueblito.mp3',             ext: 'mp3', artist: 'Jorge',                        lat: 19.6956,  lng: -101.182, city: 'morelia',       country: 'Mexico' },
  { id: '1695', name: 'chania — stream',           url: 'https://locus.creacast.com:9443/chania_stream.mp3',                ext: 'mp3', artist: 'Maria Papadomanolaki',         lat: 35.5305,  lng: 24.0568,  city: 'chania',        country: 'Greece' },
  { id: '2650', name: 'załubice nowe — summer house', url: 'https://locus.creacast.com:9443/zalubice_nowe_summer_house.mp3', ext: 'mp3', artist: 'Dorota Blaszczak',            lat: 52.472,   lng: 21.1595,  city: 'załubice nowe', country: 'Polska' },
  { id: '1421', name: 'deland — ssac',             url: 'https://locus.creacast.com:9443/deland_ssac.mp3',                  ext: 'mp3', artist: 'Stetson Acoustic Ecology Lab', lat: 29.0003,  lng: -81.3553, city: 'deland',        country: 'United States' },
];

/** Normalise one soundmap record into what the rest of the piece wants. */
/**
 * Icecast's conventional TLS port for a given plaintext one. Servers running the
 * default pair answer the same mount on both.
 */
const TLS_PORTS = { 8000: 8443, 80: 443 };

/**
 * On an https page, a stream fetched over http is mixed content and the browser
 * blocks it outright — which matters, because this piece is served from a plain
 * http localhost in development and from https everywhere else, and the soundmap's
 * list is mixed: on the day this was written, 44 of 51 live mics were https and
 * seven were not.
 *
 * Four of those seven answer the same mount over TLS, including all three Japanese
 * forest mics, which are the far-apart anchors of half the selections this piece
 * makes. So rather than dropping http sources, upgrade them and let them be tried:
 * a stream that will not open is already handled — `openStreams` is given three
 * times as many candidates as it needs and moves on down the list.
 *
 * Left alone on an http page. There is nothing to fix there, and rewriting would
 * only break the two mics that really are http-only.
 */
export function secureUrl(url, pageProtocol = globalThis.location?.protocol) {
  if (pageProtocol !== 'https:' || !url.startsWith('http://')) return url;
  try {
    const u = new URL(url);
    u.protocol = 'https:';
    const tls = TLS_PORTS[Number(u.port)];
    if (tls) u.port = String(tls);
    return u.toString();
  } catch {
    return url;
  }
}

export function normalise(raw) {
  const lat = Number.parseFloat(raw.lat);
  const lng = Number.parseFloat(raw.lng ?? raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!raw.url) return null;

  const name = String(raw.name ?? '').trim();
  const dash = name.split(/\s+[—–-]\s+/);
  const city = titleCase(raw.city || dash[0] || 'unknown');
  const detail = (dash.slice(1).join(' — ') || '').trim();

  return {
    id: String(raw.id ?? raw.url),
    url: secureUrl(String(raw.url)),
    ext: String(raw.ext || guessExt(raw.url)),
    city,
    country: normaliseCountry(raw.country),
    detail,
    artist: String(raw.artist || '').trim(),
    lat,
    lng,
    place: [city, raw.country].filter(Boolean).join(', '),
  };
}

/**
 * The soundmap's country field is free text: "UK" and "United Kingdom",
 * "netherlands" and "Netherlands", "Polska" and "Poland" all appear, and each
 * pair produced two headings for one country. This canonicalises the *grouping
 * axis* only — the microphone's own name, detail and artist are never touched,
 * so nobody's naming of their own place is overwritten in the interface.
 *
 * Catalunya is deliberately absent. It is not a sovereign state and mapping it
 * onto one would be a political claim, not a tidy-up. It stays as written.
 */
const COUNTRY_ALIASES = {
  uk: 'United Kingdom',
  'u.k.': 'United Kingdom',
  'great britain': 'United Kingdom',
  usa: 'United States',
  us: 'United States',
  'u.s.a.': 'United States',
  'united states of america': 'United States',
  polska: 'Poland',
  schweiz: 'Switzerland',
  suisse: 'Switzerland',
  svizzera: 'Switzerland',
  nederland: 'Netherlands',
  deutschland: 'Germany',
  espana: 'Spain',
  'españa': 'Spain',
  italia: 'Italy',
  ellada: 'Greece',
  'österreich': 'Austria',
  osterreich: 'Austria',
  belgique: 'Belgium',
  'belgië': 'Belgium',
};

export function normaliseCountry(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const alias = COUNTRY_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  // Case variants of the same name are the commonest duplicate of all.
  return titleCase(raw);
}

function guessExt(url) {
  const m = /\.(mp3|ogg|oga|opus|aac|m4a|wav)(\?|$)/i.exec(url || '');
  return m ? m[1].toLowerCase() : 'mp3';
}

/** "PETERBOROUGH" and "zalubice nowe" both need fixing; accents must survive. */
export function titleCase(s) {
  return String(s)
    .replace(/_/g, ' ')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, pre, ch) => pre + ch.toLocaleUpperCase());
}

/** Great-circle distance in kilometres. */
export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Greedy farthest-point selection: start from one microphone, then repeatedly
 * take whichever is furthest from everything already chosen. Four mics from
 * Amsterdam is one room; four from four continents is the piece.
 *
 * The only arbitrary decision in the whole algorithm is which mic to start from,
 * so that is where variety belongs. Randomise the seed and every session hears a
 * different world while still hearing it spread out. Pass `seed` to reproduce a
 * particular set.
 */
export function spread(sources, count, { seed = null } = {}) {
  const pool = sources.filter(Boolean);
  if (pool.length <= count) return [...pool];

  const first = seed == null
    ? pool[Math.floor(Math.random() * pool.length)]
    : pool[Math.abs(hashString(String(seed))) % pool.length];

  const picks = [first];
  const taken = new Set([picks[0].id]);

  while (picks.length < count) {
    let bestSource = null;
    let bestDistance = -1;
    for (const s of pool) {
      if (taken.has(s.id)) continue;
      let nearest = Infinity;
      for (const p of picks) nearest = Math.min(nearest, haversineKm(s, p));
      if (nearest > bestDistance) { bestDistance = nearest; bestSource = s; }
    }
    if (!bestSource) break;
    picks.push(bestSource);
    taken.add(bestSource.id);
  }
  return picks;
}

/** Small stable hash so ?seed=marseille reproduces a set. */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** How far apart the chosen mics actually are — shown during boot. */
export function minSeparationKm(sources) {
  let min = Infinity;
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      min = Math.min(min, haversineKm(sources[i], sources[j]));
    }
  }
  return Number.isFinite(min) ? min : 0;
}

/** Ask the soundmap which microphones are live right now. */
export async function fetchActive({ url = LOCUS_ACTIVE_URL, timeoutMs = 9000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
    if (!res.ok) throw new Error(`soundmap returned HTTP ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error('soundmap returned an unexpected shape');
    const list = raw.map(normalise).filter(Boolean);
    if (!list.length) throw new Error('soundmap listed no usable microphones');
    return list;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The live list if it can be had, the verified fallback if not. Never throws —
 * the piece should always have somewhere to listen.
 */
export async function loadSources(opts = {}) {
  try {
    const live = await fetchActive(opts);
    return { sources: live, live: true, note: `${live.length} microphones live now` };
  } catch (err) {
    const list = FALLBACK_SOURCES.map(normalise).filter(Boolean);
    return { sources: list, live: false, note: `soundmap unreachable (${err.message}) — using ${list.length} known mics` };
  }
}
