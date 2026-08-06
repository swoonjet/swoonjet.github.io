# Trungle Bunch

A web-based generative instrument. Triangular fruiting bodies sit on a living
mycelial network; each has three tuned edges. Threads grow toward consonance,
carry sound as travelling pulses, and rot where they go unused.

Prototype from the Notion brief *Mycelial Triangle Synth — Creative Brief*.
Colour is the Fritz hero palette.

## Run

Live at <https://jontoews.com/trungle-bunch/>.

Serve the directory over HTTP to run it locally — it is ES modules, so `file://`
will not work. Sound starts on the first click, per browser autoplay policy.

## Playing it

There are no buttons or sliders. The cursor is a hand moving through a field.

| gesture | effect |
| --- | --- |
| click bare soil | germinate a triangle |
| tap a triangle | strike the edge the field currently points at |
| drag its middle | carry it — height sets its octave |
| drag its rim | turn it, bending whatever note it is sounding |
| shove one body into another | they thud — collisions are the drum kit |
| keep hammering one body | it tempers, and its bell squares up |
| hover a cluster | it shivers and tunes itself to its neighbours |
| sweep sideways | bend time — the network's metabolic rate |
| sweep up and down | bend gravity — rooted or ascendant |
| wheel over an edge | nudge that edge into microtonal space (±95 ¢) |
| wheel over soil | push the nearest body through depth (z) |
| double-click a body | dissolve it |
| space | let the colony fall quiet |
| esc | back to the title screen, and back out again |

## The seven systems

**1 — Triangle object model.** `src/triangle.js`. Three edges, each a scale degree
plus an octave plus a microtonal offset in cents. Geometry is derived from one
angle: edge *i*'s outward normal is `θ + i·120° − 30°`. Pitch is carried as cents
above a root of 103.83 Hz everywhere and only converted to Hz at the moment of a
strike, so bends and nudges compose additively without rounding through Hz.

**2 — Placement and resonance.** `Network.fire()` strikes the edge, then excites
every body within 240 px with a quiet sympathetic ring at *its own* active pitch,
amplitude scaled by distance **and by consonance** between the two pitches.
Resonance never chains, so a cluster blooms once rather than feeding back.

**3 — Edge connections as signal paths.** A pulse travels the thread at a speed
set by the time axis and the thread's own strength, then fires the receiving
edge. Amplitude attenuates per hop and pulses die below 0.09, so a ring in the
network decays instead of ringing forever. Hops are capped at six as a backstop.

**4 — Microtonal layer.** Per-edge cents, nudged by the wheel. Hovering runs
`Network.selfTune()`: each connected edge finds the nearest just interval to its
*partner's* actual pitch and drifts toward it. Clusters therefore lock into
chords with each other rather than to an absolute grid — the network discovers
its own tuning. Snap targets are weighted by ratio simplicity, so a fifth wins
over a tritone.

**5 — Growth and decay.** Candidate pairs are scored on consonance, distance, and
how squarely their edges face each other. A hyphal tip grows across; on arrival
the thread goes live and thickens with use. It thins from disuse and from
*strain* — rotate a body away and its threads pull off aim. Past a strain
threshold a thread **re-roots** onto a better-aimed free edge before it gives up,
which is what keeps a spinning colony connected.

**6 — The gravity / spirit axis.** One number, −1 rooted to +1 ascendant, and it
reaches everywhere: it rotates the field direction (so it decides *which* edge is
active on every body, re-voicing the whole colony as you sweep), sets the band
the colony settles into, spreads or collapses z, and opens the master tilt filter
from 1.25 kHz to 9.5 kHz while shortening decays, reducing inharmonicity, and
adding reverb. Rooted is dark, sparse, and slow; ascendant is bright, shimmering,
and busy. A very slow autonomous tide keeps it drifting when untouched.

**7 — Gesture UI.** `src/input.js`. Sweep velocity feeds two accumulators that
bleed away, so the axes have momentum and drift home when you stop moving.
A drag near a body's centre carries it; a drag on its rim turns it.

## Title screen

`esc` returns to the title, which doubles as the gesture reference card. The
colony keeps growing behind the veil and the audio only **ducks** to 16% rather
than stopping, so it reads as stepping back from the instrument, not switching it
off. Every gesture is inert while the title is up — the axes rest, so reading the
card cannot accidentally bend time. Clicking or `esc` returns you. Only the very
first entry plants a triangle where you click; coming back leaves the colony
alone.

## Tendrils

Sticky and aggressive, deliberately. Reach is 420 px, tips cross in about a third
of the time they used to, a thread thickens off faint affinity (0.05), grabs from
edges that are barely facing at all, re-aims onto a better edge at the first real
improvement, and comes back for a broken pair within about a second. Idle rot is
down to a fifth of what it was, and a thread will stretch half again past its
reach before it begins to suffer.

The stickiness is a spring at 1.8× the old stiffness hauling toward a rest length
just clear of contact, so a dragged body drags its neighbours with it. The
renderer shows the load: slack goes out of a stretched thread, it lights along
its length, and the tendril flares where it grips an edge, digging in harder the
further you pull.

One guard was needed. A denser, stickier mesh turns a single strike into a
runaway branching cascade, so a firing body now splits its signal across at most
its three strongest threads with a 1/√n attenuation. Without that the pulse count
pins to its ceiling and the voice pool thrashes.

## Sound

**Major, throughout.** The scale's third is 5/4, so the colony is a just *major*
scale and everything else is tuned against that.

### A library of six families

Not one instrument with variations — six different ways of making a sound, in
`src/voices.js`. All struck, plucked or blown; nothing resonates or screams.

| family | what it is |
|---|---|
| `bar` | soft mallet on a tuned bar. Marimba: the 4× overtone dies to 5–24% while the body still rings |
| `skin` | a hand on a drum head. Pitched noise over a falling tone, no stick |
| `pluck` | Karplus-Strong. A noise burst trapped in a damped delay loop — a real physical decay, not an envelope |
| `bowl` | a singing bowl. Inharmonic partials (1, 2.32, 3.51, 5.07) in detuned pairs, so it beats against itself |
| `drop` | water. The only voice that bends **upward**, which is what makes it read instantly as something else |
| `air` | blown. Resonant noise at pitch over a quiet sine, soft attack — breath rather than a strike |

Levels are matched by a measured per-family `trim`. Untrimmed the library spanned
**30 dB**; a feedback loop and one short sine are nowhere near each other
naturally. It now sits inside 9.7 dB, which is instrument-to-instrument variation
rather than a fault.

### Shape is a continuous timbre control

Drag a body's **corners** and its outline deforms — each corner carries its own
radius and swing. Three descriptors come off that geometry and move the character
*within* whichever family the colour pair chose:

- `size` — squat and broad → longer and darker; small and tight → short and bright
- `skew` — distance from equilateral → noise, inharmonicity, detune spread
- `spike` — one corner hauled out → thin and bright

Shape deliberately does **not** touch pitch. The colony has to stay in tune with
the major drone, so geometry moves timbre, decay and noise instead.

### Sirens, deliberately

A ringing note follows the live gravity angle plus its own ±330-cent siren sweep,
phase-offset per body so the colony wails as a chorus. The sweep applies **only
to notes already sounding**: a note lands in tune and *then* wanders. Bells slide
in 97% of sustained frames at a median 641 cents/sec.

### A drone that is part of the stage

| stage | drone |
|---|---|
| one lone body | root only, level 0.10 |
| eight bodies | root + fifth + tenth, 0.19 |
| crowded | full chord + octave, 0.22–0.29 |
| mid-burst | ducked to 0.06 |
| 7 s quiet | back to 0.29 |

The chord fills out as the colony grows and the level rises with it. Activity
**ducks** it like a sidechain — fast to fall, slow to lift. It holds one key with
hysteresis, crossfades rather than glides (0% sliding), and folds into 44–88 Hz.

**Drums in the colony's own playing.** Besides collisions, a body with no charge
left cannot ring: a pulse arriving on it thuds instead, so cascades through a
depleted cluster come out as rhythm.

## Colour combinations decide the voice

Every edge belongs to a channel by pitch class. When a body strikes, its channel
is paired with the channel of whatever that edge is **joined to** — or its
nearest neighbour if it is joined to nothing. The six unordered pairs are six
patches:

| pair | patch | character |
|---|---|---|
| Flarepop × Flarepop | `flare` | hard saw, steep fast boing |
| Coolsweep × Coolsweep | `scan` | hollow square, long even fall |
| Wiretree × Wiretree | `signal` | soft and rubbery, deepest sub |
| Flarepop × Coolsweep | `breach` | narrow pulse, Q 17, hardest boing |
| Flarepop × Wiretree | `bloom` | warm and wide, low slow sweep |
| Coolsweep × Wiretree | `wire` | thin and singing, the one that whistles |

So a triangle's sound is not a property of the triangle — it is a property of the
company it keeps. Drag a body to a new neighbour and its voice changes. Each
thread is drawn as two hard-split halves, one in each end's channel, so the
combination a thread is making is visible; the HUD names the ones in play.

## The two discoveries

Neither is a control. Both are things the instrument does that you find by playing it.

**Tempering — how the bell changes.** Every body keeps a leaky count of recent
strikes. Sustained hammering raises its `temper`; quiet lets it soften over about
ten seconds. Temper picks a rung from a bank of `PeriodicWave`s built as a Fourier
lerp between a **triangle wave** (odd harmonics at 8/π²n², alternating sign) and a
**square wave** (odd harmonics at 4/πn, constant sign). A soft body is glassy and
bell-like; a worked body squares up and starts to reed. It also loses its bar-like
inharmonicity and brightens, and its bowed edges visibly straighten as it hardens.

The discrimination is deliberate: ambient self-firing (~0.3 strikes/s per body)
tempers a body to about 0.1 and you hear almost nothing. Deliberate tapping at
~4/s reaches 0.77 in three seconds. You have to *mean* it.

**Collisions — where the drums come from.** Shove one body into another and the
contact strikes a membrane: a pitch-drop body falling nearly two octaves into its
fundamental, a filtered noise click for the contact, and a resonant noise skin.
Pitch comes from the pair's combined size, so big bodies thud low and small ones
snap. Rooted collisions are dead; ascendant ones ring like a frame drum. A body
driven into the rim of the dish gets the deader, lower version.

Contacts are latched until the pair separates, so a resting overlap can't
machine-gun. A knock also shakes some charge loose and works the body a little,
so drumming a cluster tempers its bells too.

## Colour — Fritz hero palette

Three channels in their locked roles: **Flarepop** `#FF00E5` primary, **Coolsweep**
`#1A7AFF` secondary, **Wiretree** `#00D862` tertiary, on Carbon `#0A0A0F` with Halo
neutrals for threads and pulses. Every hex in `src/` is a kit token.

Two brand rules shaped the design rather than just the values:

- **Channel families never blend into each other.** A naive pitch→hue ramp is
  exactly the banned Flarepop-to-Coolsweep purple. So pitch class picks a
  *channel* — the octave cut in three with hard boundaries — and energy steps that
  channel's *own* five-rung ramp. A chord now reads as two or three distinct brand
  channels instead of a smear across the colour wheel, which is better information
  design than what it replaced. The gravity axis crosses from a Flarepop ground to
  a Coolsweep one through neutral Carbon, as a hard cut.
- **No smooth gradients.** There is not one `createRadialGradient` left in the
  renderer. The substrate is concentric hard-edged bands, a struck body throws
  stepped shock rings, and thread strength, depth and energy are all quantised.
  `STEPS` in `src/palette.js` is the single dial — raise it for a finer read, drop
  it for blockier.

Shading from a **hit or bounce** is where the stepping pays off: a collision
marches `STEPS` hard slabs in from the struck side, clipped to the body, in the
channel of whichever edge took the blow.

## Audio

Hand-rolled Web Audio rather than Tone.js — the instrument needs per-partial
frequency ramps for glissando on an already-sounding voice, and precise cent
offsets, both of which are more direct at this level.

Each voice is a struck-bar model: partial ratios blend between the harmonic
series and an ideal bar (`[1, 2.756, 5.404, 8.933, …]`), so `inharmonicity`
slides a voice from pitched to metal wind chime. Higher partials decay faster.
A short filtered noise transient supplies the contact before the tone. Voices
route through a per-voice lowpass and panner into a dry bus and a procedural
convolution reverb; z depth sets the reverb send.

Voices are capped at 26, and the engine steals the **quietest** rather than the
oldest, so a background resonance dies before the note you just played. Two
things matter about the pool: a stolen voice is spliced out of it immediately
rather than merely given a nearer end time — several strikes can land inside one
frame, during which `ctx.currentTime` does not advance, so a time-based
retirement never fires and the pool grows without bound (this was real: a burst
across every body reached 192 live voices against a cap of 22). And retirement
runs on a clock from the frame loop, not only when a voice is struck, because a
colony that falls quiet stops striking and would otherwise leave every finished
voice's gain/filter/panner chain attached to the graph forever.

A quiet sustained bed tracks the network's most-reinforced pitches, which is
what makes an idle colony still sound alive.

## Verifying it

`test/audio-render.html` renders the autonomous network through an
`OfflineAudioContext` and measures the result — the only way to confirm the
instrument sounds without a user gesture. Open it and read the JSON.

Last run: peak −2.7 to −2.3 dBFS across all three gravity states, zero clipped
samples, DC-free, and per-second RMS that varies by roughly 5× across a take (it
evolves rather than droning).

It also measures the two new voices directly:

- **Waveform morph**, by DFT at the fundamental's odd multiples. Temper 0 gives
  odd-harmonic ratios `1 / 0.103 / 0.045` (ideal triangle 3rd = 0.111); temper 1
  gives `1 / 0.285 / 0.163` (ideal square 3rd = 0.333). The morph is real and
  measured, not asserted.
- **Drum**, peaking at 0.32 with per-second RMS `0.056 → 0.003 → 0.0006` — over
  inside a second, as a struck membrane should be.

At the 42-body cap with 36 live threads, step + draw costs 0.54 ms per frame,
about 3% of a 60 fps budget.

## Layout

```
index.html          shell, gesture legend
style.css
src/util.js         math, easing, colour mixing, wobble noise
src/palette.js      Fritz hero channels, pitch→channel, hard-step quantising
src/tuning.js       cents, the just scale, consonance, just-interval snapping
src/audio.js        Web Audio engine — struck-bar voices, triangle→square wave
                    bank, collision drums, reverb, bed, tilt
src/triangle.js     the body: geometry, three tuned edges, rotation bend
src/network.js      simulation — growth, decay, pulses, resonance, collisions,
                    the 5 axes
src/render.js       canvas: substrate, threads, hyphae, pulses, bodies
src/input.js        gesture layer
test/audio-render.html
```

## Known limits

- `octaveBias` is quantised to whole octaves. A continuous version was audibly
  worse: nothing in the colony was ever in tune with anything else.
- Bodies never wither on their own. An isolated triangle dims but survives,
  because silently losing something you placed is worse than a dim colony.
- At the 42-body cap, germinating evicts the least-connected, quietest body.
- Mobile works through pointer events, but the two sweep axes need a cursor to
  feel like anything.
