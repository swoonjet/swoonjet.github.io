// The voice of the piece.
//
// Given two things that happened close together — usually in two places
// thousands of kilometres apart — and the relation between them, write the line
// the session will remember it by. Every choice is seeded from the events
// themselves, so the same coincidence always produces the same sentence. The
// world is being read, not randomised.

import { hash, pick, clamp } from '../core/util.js';
import { CONFIG } from '../core/config.js';

const LOUDNESS = [
  [0.14, 'barely'],
  [0.30, 'quietly'],
  [0.55, ''],
  [0.78, 'plainly'],
  [1.01, 'insistently'],
];

// Where in the air the sound sat, not where on earth — the place name comes
// from the microphone.
const PLACE = [
  [0.22, 'somewhere underneath'],
  [0.42, 'low down'],
  [0.62, 'at chest height'],
  [0.82, 'high up'],
  [1.01, 'at the very top of the air'],
];

const CONNECTORS = {
  shared:   ['and', 'beside', 'answering', 'with'],
  contrast: ['against', 'cutting across', 'refusing', 'set hard against'],
  bridge:   ['under', 'over', 'leaning toward', 'threaded through'],
  far:      ['somewhere near', 'faintly with', 'half a world from', 'in the same weather as'],
  none:     ['and', 'then', 'alongside'],
};

// What a bridging tag lets the piece say. These are the omens. They have to read
// in a wood in Japan and a harbour in Peru alike, so nothing here may assume a room.
const FIGURES = {
  machine:   ['somewhere a machine admits that it is running', 'something mechanical takes the part of the chorus'],
  current:   ['a current runs under all of it and keeps running', 'the wiring is doing the singing tonight'],
  ocean:     ['one place remembers a coastline the other has never had', 'everything is tidal now'],
  weather:   ['the same weather has reached both', 'this is not a moment, it is a season'],
  wind:      ['something is being carried away and not replaced', 'the air takes the long way out'],
  distance:  ['whatever it was, it was already leaving', 'the far side of the wall answers first'],
  sleep:     ['somewhere is trying to put itself under', 'a slow hand pulls the light down'],
  dread:     ['a small refusal, low down, that will not resolve', 'the ground knows something the air does not'],
  below:     ['the weight is not evenly spread across the world tonight', 'something settles that had been holding itself up'],
  mass:      ['the heavy thing moves and the light things notice', 'gravity gets a solo'],
  floor:     ['the ground takes the downbeat', 'everything is measured from underneath'],
  human:     ['someone is there, and the place has changed shape for them', 'the piece acquires a witness'],
  company:   ['two presences agree to occupy the same minute', 'neither place is alone any more'],
  warmth:    ['the cold reading is overruled', 'the machine hears warmth and does not know what to do with it'],
  release:   ['whatever was held is let go of, briefly', 'the tension finds a door'],
  break:     ['the pattern breaks and is better for breaking', 'the composure fails in a useful direction'],
  alive:     ['something out there is breathing on its own schedule', 'the piece is no longer the only living thing'],
  small:     ['a small thing insists on being counted', 'the smallest event carries the sentence'],
  flight:    ['a line leaves the ground and stays left', 'the high register empties out'],
  morning:   ['it becomes early somewhere, whatever the hour is here', 'the light in the sound changes'],
  forest:    ['the piece grows an outside', 'no wall is the edge of this'],
  arrival:   ['something has come to the door of the piece', 'a beginning arrives without asking'],
  threshold: ['a question is asked at the edge of somewhere', 'this is the seam of the piece'],
  question:  ['the sound ends on a rise and does not come down', 'an interrogative, unanswered, allowed to stand'],
  answer:    ['the second sound settles the first', 'the reply arrives before the question is finished'],
  approach:  ['whatever it is, it is getting nearer', 'the distance between the listener and the event is closing'],
  intent:    ['this was done on purpose, by something', 'a decision is audible'],
  rhythm:    ['the accident keeps time', 'coincidence has developed a pulse'],
  patience:  ['the piece agrees to wait for it', 'nothing is in a hurry and that is the point'],
  waiting:   ['a held breath nobody there remembers to release', 'the interval is doing the work'],
  time:      ['the clock in this piece is made of water', 'duration becomes the subject'],
  water:     ['both places are condensing', 'everything has a wet edge tonight'],
  grain:     ['the texture comes apart into countable pieces', 'the surface turns out to be many small things'],
  many:      ['one sound turns out to have been a crowd', 'the singular fails'],
  glass:     ['a hard bright surface takes the impact', 'something rings that was meant to stay silent'],
  secret:    ['the piece overhears something not meant for it', 'the meaning stays just under the threshold'],
  meaning:   ['for a moment it is nearly language', 'sense assembles and then declines to stay'],
  signal:    ['something is being said in the wrong alphabet', 'a message with the content removed'],
  effort:    ['the work of it is audible', 'something is being pushed and it resists'],
  friction:  ['two surfaces disagree, out loud', 'the piece runs its hand along a rough wall'],
  resistance:['what pushes back becomes the counter-melody', 'the obstacle takes a solo'],
  corridor:  ['the sound arrives with a hallway attached', 'the space is longer than it should be'],
  wood:      ['somewhere answers in its own material', 'a knock on the piece from the outside'],
  surface:   ['everything is happening on the skin of things', 'nothing gets in, it all stays on the outside'],
  erasure:   ['something is quietly removed from one of them', 'a subtraction disguised as a sound'],
  edge:      ['the piece finds its own border and leans on it', 'this is where the description stops working'],
  stranger:  ['an unclassified visitor, given a chair anyway', 'the library has no entry for this'],
  unknown:   ['the system declines to name it and keeps listening', 'no match, and the not-matching is the event'],
  sustain:   ['a note that has decided to become furniture', 'the long tone outlives its cause'],
  open:      ['a door somewhere is open and staying open', 'nothing is sealed'],
  cave:      ['the space behind the space announces itself', 'the reverb is older than the microphone'],
  hand:      ['a hand is involved, briefly', 'the human scale asserts itself'],
  weight:    ['something has mass and is not embarrassed by it', 'the low end acquires a body'],
  address:   ['somewhere is spoken to directly', 'someone talks to the place they are standing in'],
  furniture: ['the objects take a turn', 'the inanimate makes a contribution'],
};

const GENERIC = {
  shared:   ['two things agree without discussing it', 'the coincidence holds long enough to mean something'],
  contrast: ['the two refuse each other and the refusal is the music', 'neither gives way; the piece keeps both'],
  bridge:   ['a thin connection, but it holds', 'the link is loose and the looseness is the point'],
  far:      ['a long association, almost not there', 'the connection has to be reached for'],
  none:     ['two unrelated facts, laid side by side', 'no relation, only proximity — which is also a relation'],
};

const ACT_LINES = {
  listening:   'the world is being read',
  noticing:    'shapes are beginning to repeat',
  figure:      'a figure has formed',
  development: 'the material is being worked',
  recession:   'the piece steps back to listen again',
};

/**
 * "a low hum in Chania" — the noun phrase for one event. When the event came
 * from a named place, the place is the most interesting thing about it and wins
 * over the register description.
 */
export function describeEvent(event) {
  const base = event.pattern.noun;
  const loud = band(LOUDNESS, event.desc.peak);
  const height = band(PLACE, event.desc.centroidMean);
  const where = event.place ? `in ${event.place}` : null;
  const seed = hash(`${event.patternId}:${event.id}`);

  const forms = where
    ? [`${base} ${where}`, `${base} ${where}`, loud ? `${base}, ${loud}, ${where}` : `${base} ${where}`, `${base} ${height} ${where}`]
    : [`${base}`, `${base} ${height}`, loud ? `${base}, ${loud}` : `${base}`, `${base} ${height}`];
  return pick(forms, seed);
}

function band(table, v) {
  for (const [limit, value] of table) if (v < limit) return value;
  return table[table.length - 1][1];
}

function figureFor(relation, seed) {
  const pool = (relation.tag && FIGURES[relation.tag]) || GENERIC[relation.kind] || GENERIC.none;
  return pick(pool, seed);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Distance is the piece's own material. Two microphones on different continents
 * doing the same thing in the same second is the omen; say how far apart they
 * were and let that do the work.
 */
export function formatDistance(km) {
  const n = Math.round(km);
  if (n >= 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')} thousand kilometres apart`;
  return `${n.toLocaleString('en-US')} km apart`;
}

/** The line for a coincidence between two events. */
export function figureLine(a, b, relation) {
  const seed = hash(`${a.patternId}/${b.patternId}/${relation.kind}/${relation.tag}/${a.id}`);
  const connector = pick(CONNECTORS[relation.kind] ?? CONNECTORS.none, seed >>> 3);
  const figure = figureFor(relation, seed >>> 5);
  const far = relation.distanceKm >= 1500
    ? `${formatDistance(relation.distanceKm)}, and `
    : '';
  return `${cap(describeEvent(a))} ${connector} ${describeEvent(b)} — ${far}${figure}.`;
}

/** The line for a motif coming back. */
export function returnLine(motif, variation, event) {
  const seed = hash(`${motif.id}/${variation.returnIndex}`);
  const openers = [
    `${cap(motif.name)} again`,
    `${cap(motif.name)}, returning`,
    `${cap(motif.name)} comes back`,
    `Once more, ${motif.name}`,
  ];
  const ordinal = ['a second time', 'a third time', 'a fourth time', 'yet again', 'as usual'];
  const which = ordinal[Math.min(variation.returnIndex - 1, ordinal.length - 1)];
  return `${pick(openers, seed)} — ${which}, ${variation.label}.`;
}

/** A single event with nothing to pair with, but too striking to drop. */
export function soloLine(event) {
  const seed = hash(`solo:${event.patternId}:${event.id}`);
  const tag = event.pattern.tags?.[seed % (event.pattern.tags?.length || 1)];
  const figure = (tag && FIGURES[tag]) ? pick(FIGURES[tag], seed >>> 4) : pick(GENERIC.none, seed);
  return `${cap(describeEvent(event))}, alone — ${figure}.`;
}

/**
 * The arc. Not a plot: a slow read on how much is happening and whether the
 * room has started to repeat itself.
 */
export class Narrator {
  constructor() {
    this.act = 'listening';
    this.tension = 0;
    this.lastFigureMs = -1e9;
    this.figures = 0;
    this.returns = 0;
    this.log = [];
    this.onEntry = null;
  }

  update(nowMs, dt) {
    this.tension = clamp(this.tension - CONFIG.orchestra.tensionDecayPerSec * dt, 0, 1);
    const sinceFigure = nowMs - this.lastFigureMs;

    let act = this.act;
    if (this.tension > 0.72 && this.returns > 0) act = 'development';
    else if (sinceFigure < 6000) act = 'figure';
    else if (this.tension > 0.34) act = 'noticing';
    else if (sinceFigure < 22000) act = 'recession';
    else act = 'listening';

    if (act !== this.act) {
      this.act = act;
      this.push({ kind: 'act', text: ACT_LINES[act], timeMs: nowMs, act });
    }
    return this.act;
  }

  canWriteFigure(nowMs) {
    return nowMs - this.lastFigureMs > CONFIG.orchestra.figureCooldownMs;
  }

  writeFigure(a, b, relation, nowMs) {
    const text = figureLine(a, b, relation);
    this.lastFigureMs = nowMs;
    this.figures++;
    this.tension = clamp(this.tension + 0.22 + relation.strength * 0.18, 0, 1);
    return this.push({ kind: 'figure', text, timeMs: nowMs, relation, a, b });
  }

  writeReturn(motif, variation, event, nowMs) {
    this.returns++;
    this.tension = clamp(this.tension + 0.16, 0, 1);
    return this.push({
      kind: 'return',
      text: returnLine(motif, variation, event),
      timeMs: nowMs, motif, variation,
    });
  }

  writeSolo(event, nowMs) {
    this.tension = clamp(this.tension + 0.07, 0, 1);
    return this.push({ kind: 'solo', text: soloLine(event), timeMs: nowMs, event });
  }

  push(entry) {
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    this.onEntry?.(entry);
    return entry;
  }
}
