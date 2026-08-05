// The three readings of the same data. Only one is on the stage at a time.
//
// Kept as plain data, away from the wiring, because three places need to agree
// about it: the menu that offers them, the loop that draws one of them, and the
// caption under the stage that says what is being looked at.
//
// `bloom` is first and is the default. It is the reading that says least about
// measurement and most about the thing being measured.

export const VIEWS = [
  {
    id: 'bloom',
    canvas: 'bloom',
    key: '1',
    name: 'bloom',
    axes: false,
    blurb: 'Growth. Time ripples outward from now.',
    caption: 'Frequency around the circle, mirrored so there is no seam; time rippling outward from now; every place sharing one mapping, so a coincidence reads as swells that line up.',
  },
  {
    id: 'contour',
    canvas: 'contour',
    key: '2',
    name: 'contour',
    axes: false,
    blurb: 'Survey. Lines joining points of equal energy.',
    caption: 'The frequency and time plane surveyed as a height field: lines joining points of equal energy. A sustained tone is a long ridge, a transient a closed island, and two places holding a frequency together nest into each other.',
  },
  {
    id: 'ridge',
    canvas: 'stage',
    key: '3',
    name: 'ridge',
    axes: true,
    blurb: 'Measurement. One stacked layer per place.',
    caption: 'One layer per microphone. Vertical threads mark a chord: two places holding the same frequency in the same moment.',
  },
];

export const DEFAULT_VIEW = VIEWS[0].id;

export const viewById = (id) => VIEWS.find((v) => v.id === id) ?? VIEWS[0];

export const viewByKey = (key) => VIEWS.find((v) => v.key === key) ?? null;

export const nextView = (id) => VIEWS[(VIEWS.findIndex((v) => v.id === id) + 1) % VIEWS.length].id;
