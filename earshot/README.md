# Live Spectrogram Ambient Collage

A real-time ambient audio and visual collage built entirely from live microphone
input — **open field microphones installed in places around the world**, not
local hardware. The system listens to several of them at once, reads what
arrives as spectrograms, and uses that reading to blend, trigger and visualise
an evolving composition.

Because the microphones are thousands of kilometres apart, the coincidences the
piece composes from are coincidences *between places*: a hum in Otsuchi and rain
in Lima inside the same three seconds. That is the material.

**No pre-recorded audio exists anywhere in this project.** There are no sample
files. The reference library is a set of *descriptions* of how sounds move
through a spectrogram, not recordings of them. Every generated layer is made
from the streams themselves — grains of live capture from seconds ago, the live
signal driven through resonators, and a reverb whose impulse is generated at
runtime.

## Running it

```
./serve.sh                      # http://localhost:4462/
PORT=5000 ./serve.sh            # or pick your own port
```

Serve over `http://localhost` (or https): it is a secure context, which the
Web Audio graph needs. The server sends `no-store` on everything, because a
cached ES module is indistinguishable from a bug you cannot reproduce.

There is **no microphone permission prompt** — the piece does not touch local
hardware. Open the page and it starts on its own if the browser lets it;
otherwise press **Begin listening** once, because browsers require one gesture
before any audio. After that nothing needs clicking: the live microphone list is
fetched, the furthest-apart set is chosen, and each stream is opened as the
sequence reaches it.

**Keep the tab in the foreground.** Browsers do not decode media in background
tabs, so a stream opened there sits at `readyState 0` forever. The piece detects
this and waits, telling you why, rather than hanging.

### On a phone

iOS is the strict case, and it needed a specific fix. It will not load or play
media it does not consider user-initiated, and "user-initiated" means *the same
task as the tap* — not a second later, not after an `await`. It also ignores
`preload`, so an element never played in a gesture never fetches a byte. This piece
cannot satisfy that naively: at the moment of the tap it does not yet know which
microphones exist, because the soundmap has not been asked.

So the tap primes a **pool** of media elements by playing a moment of silence
through each — that is what unlocks them — and the streams are attached to those
already-unlocked elements seconds later (`src/audio/mediapool.js`). Each entry
keeps its own `MediaElementAudioSourceNode` for life, because an element may be
given exactly one, ever: a second call throws `InvalidStateError`, verified in a
browser. Recycling the *pair* is the only way to recycle an element at all.

**The route into the graph is made late**, once the real stream URL is on the
element, and this distinction is the difference between hearing the piece and merely
hearing the streams. WebKit does not reliably keep an element routed when its `src`
changes after the node exists, and a broken route fails in the cruellest possible
way: the element plays out of the speaker exactly as it should while every analyser
reads nothing. The piece then sounds like four microphones and draws a frozen
picture — which is what the first version of this pool did on an iPhone. The pool
also spends never-yet-routed elements first, and a stream that cannot be routed at
all now fails outright rather than playing unheard.

Because that failure looks like health from every other angle, the piece watches for
it: a stream that has been live for four seconds without the analyser ever seeing a
single finite reading is reported on the page as *"playing, but not reaching the
analyser"*. A suspended audio context is named in the status bar for the same
reason.

Two bugs of the project's own showed up alongside it, and both were worse than the
platform policy:

- **`canplay` was treated as "audio is flowing".** It is not — it means enough has
  buffered to begin, and it fires perfectly happily on a browser that has decided
  not to let this play. That is why an iPhone reported four live streams and made
  no sound: the piece believed them, drew them, and only the health check noticed
  twelve seconds later that no clock had ever advanced. Readiness now means the
  clock is moving: `playing`, or a `timeupdate` past zero.
- **The rejection from `play()` was swallowed**, discarding the single most useful
  thing the browser had said. A `NotAllowedError` now fails the connection
  immediately and by name, rather than waiting out a timeout for an answer already
  given — measured at 1 ms instead of 12 s.

And the failure reason is now **on the page**, not only in a `title` attribute. A
hover tooltip is invisible on a touch device, which is exactly where a stream is
most likely to be blocked and least likely to explain itself.

One thing no code can fix: on iPhone and iPad the hardware **ring/silent switch
mutes Web Audio**, and this piece is nothing but Web Audio. The boot screen says so
on those devices, because otherwise it reads as a bug.

Options:

| | |
| --- | --- |
| `?mics=6` | listen to six places instead of four (six is the cap — one distinct ink per channel) |
| `?seed=marseille` | reproduce a particular selection; without it every session is different |
| `?mic=1`  | *also* analyse the local microphone as an extra channel — off by default, and never routed to the output |

## Where the sound comes from

[Locus Sonus](https://locusonus.org/soundmap/) runs a network of open
microphones — permanently installed, openly streamed. Its soundmap publishes
which are live at any moment; on a normal day that is around fifty, in twenty-odd
countries. `src/audio/sources.js` asks for that list and picks from it.

Two properties make this work at all, and both were verified rather than assumed:

- The list endpoint **and** the audio streams send `Access-Control-Allow-Origin: *`.
  Without it the browser taints the media and every analyser reading comes back
  as silence — no proxy would be needed, but nothing would work either.
- Selection is a greedy **farthest-point** pass, not the head of the list. The
  soundmap is lopsided — on any given day a third of the live mics can be in one
  or two cities — and four microphones in Amsterdam is one room, not the world.

**Every session starts somewhere different.** The only arbitrary decision in the
farthest-point pass is which microphone to begin from, so that is where variety
belongs: the seed is random unless you pass `?seed=`. A different world each
time, still spread across the planet. `random spread` in the library draws a
fresh set without reloading.

A baked-in fallback list of ten verified mics covers the soundmap being
unreachable. The live list is always preferred: these installations come and go,
and a hard-coded stream is a stream that will eventually be a lie.

Field microphones are unreliable by nature — solar power, domestic broadband, a
box in a wood. `src/audio/remote.js` reconnects with capped backoff and reports
state per channel. It judges health by whether the media clock is advancing,
**not** by whether there is any sound: a microphone in a forest at 3am is silent
and perfectly healthy, and treating quiet as broken would throw away the best
material in the piece.

## The frame

Three columns, split by what changes. The left is live state — which places are
playing, how loud each is, and the controls that alter them. The centre is the
stage. The right is reference: where those places are, the shapes the piece
listens for, and who installed the microphones. Below 1080px the columns stack in
that order, with the stage at 46vh.

It was one 260px rail holding all of it, which meant 752px of content
inner-scrolling through 356px of room — the map and the credits sat two folds
below anything you were looking at, and at a normal window you could never see the
microphone list and the map at the same time. Split, both columns fit whole at
1440×865 with room to spare, and the worst case (six places, the hard cap, in a
short window) scrolls the live list by a fraction of what it used to hide.

A place's row carries its ink as a **column**, not a bar: full strength for the
level, a fifth strength behind it so a silent place still says which layer on the
stage is its. It used to be a horizontal bar under each row, which put a rule line
under every place in a design whose first principle is that it has no rules — and
saturated on every channel besides, so it distinguished nothing.

The **reference library** draws each entry as a small spectrogram figure built from
that entry's own criteria: register profile sets where it sits and how tall it is,
duration sets its width across two and a half decades of time, spectral flatness
decides between a line and a broken band, onset density makes it one mark or
sixteen, modulation wobbles it, a falling centroid tilts it, a short attack gives
it the broadband edge a click opens with. A bird is a high short arc; a hum is a
long low line; rain is a fine scatter; wind is a band and a scrape is the same band
roughened by its own jaggedness. Nothing in the drawing is invented — every
dimension traces back to a number in `patterns.js`, which is the point, because
"shapes, not samples" should be shown rather than asserted. `src/ui/shapeglyph.js`,
and the scatter inside a mark is seeded from the entry's id so a reference does not
redraw itself differently on every load. A match takes the whole row into accent
and prints its confidence as a figure; the bar it replaced was the loudest thing in
the sidebar and the least precise.

The mixer and record controls are a fixed dock, because a thumb reaches the bottom
edge of a phone and not much else. That put it over the right end of the status bar
on a desktop, where trouble is reported — "2 places could not be opened" was drawn
underneath it and read as `2 pl` — and over the whole bar on a phone. The dock's
size is measured and published as `--dock-w` / `--dock-h` (it widens by a meter
while recording, so a constant in the stylesheet would be wrong in one state or the
other), the bar reserves that much, and the page ends above it rather than behind
it. Trouble also reads as the bar's last cell now instead of being pinned right,
and the bar wraps rather than crushing its last cell to one word per line.

## The three views

A menu in the status bar names all three — **bloom**, **contour**, **ridge** —
each with a line saying what it is, and `1`, `2`, `3` select them directly whether
the menu is open or not. Bloom is the default: the piece opens as something growing
rather than something measured. One reading dissolves into the next over 420 ms.

This replaced a control that cycled. Cycling is the cheapest control to build and
the worst to use: it names where you will end up rather than where you can go, it
cannot say what any of the choices are, and reaching the third of three means
passing through the second.

**Contour** surveys the frequency/time plane as a height field and draws iso-lines
joining points of equal energy, the way a map joins points of equal altitude. A
sustained tone is a long ridge running down the sheet, a transient a closed
island, and quiet is open ground. All the places are drawn into one rectangle in
their own inks, so two of them holding the same frequency produce contours that
nest into each other — the chord arrived at by the drawing rather than annotated
onto it. Marching squares over a **blurred** field; unblurred, a spectrogram
contours into a thicket of noise-islands rather than landscape.

This view was jittery, and the cause was not noise: everything about it was
quantised. Four measures, all in `CONFIG.contour`, and the fix is measurable — the
frame-to-frame change in the drawn image had a standard deviation as large as its
mean (half of 90 frames identical, the rest jumping); it is now 7% of its mean,
with no frozen frames.

1. **The sheet scrolls continuously** (`scroll`). History advances 30 times a
   second and a grid row spans `rowStride` frames, so the whole image used to jump
   half a row at a time. It now slides by the fraction of a frame elapsed.
2. **A grid row is the mean of the frames it spans** (`decimate`), not the one
   frame that happened to be sampled. Point-sampling a 30 Hz field at 15 Hz
   aliases, and aliasing on a contour plot looks like islands blinking.
3. **The field eases** toward each new reading rather than being replaced
   (`settleMs`, 110 ms). On a scrolling field that is a short motion blur along
   the time axis, which is the intent: ink drags a little as the sheet moves under
   it, a band hovering at a level stops flickering across it, and new material
   grows in at the "now" edge instead of appearing.
4. **Contours are chained into whole polylines and cut smooth** (`smoothPasses`,
   Chaikin twice), instead of being emitted as loose segments. Loose segments cost
   more than they look: in multiply every round cap overlaps its neighbour's and
   the line beads, there is no path to smooth so the marching grid's staircase
   stays, and there is nothing to measure so a two-cell noise island is as
   important as a ridge — `minCells` now culls the specks. Chaining is exact
   rather than tolerance-based: a crossing lives on a specific grid edge, so it is
   named by that edge, and the two cells sharing an edge name the same crossing by
   construction. No float keys, no epsilon, no gaps.

The geometry is re-traced only when the history advances, at 30 Hz, and the sheet
is *moved* on every render frame — a translation of an already-traced `Path2D`.
Measured on three channels: 2.8 ms to re-trace, 0.01 ms of JS to move.

**Ridge** is the analytical one: one layer per microphone, frequency across, time
receding, hidden-line removed. Described further down.

**Bloom** is the other kind of true. Frequency runs around the circle, time
ripples outward from the centre, amplitude bulges the radius. Three decisions do
most of the work:

- The spectrum is **mirrored** around the circle rather than wrapped. Wrapping it
  once would put a hard seam where Nyquist meets DC; mirroring removes the seam
  and leaves bilateral symmetry, which is what makes leaves and shells read as
  organic rather than mechanical.
- Everything is **interpolated**: Catmull-Rom across frequency, a rolling mean
  across time, and Catmull-Rom again to turn each sampled contour into beziers.
  There is no step anywhere in the geometry.
- It draws in **multiply, stroke-led**. An earlier version filled every contour,
  and fourteen filled contours per channel stack into a solid disc — a blob, not
  a bloom. The fills are gone; the line does the work, over a lot of paper.

Every channel uses the whole radius, staggered by a fraction of a contour gap so
the sources interleave and beat against each other instead of forming concentric
targets where the outermost hides the rest.

**Coincidence is not marked in this view, and does not need to be.** All channels
share one angular mapping, so the same frequency lands at the same angle on every
one of them and two places holding a frequency together read as swells that line
up into a spine radiating from the centre. An earlier version offset each channel
by the golden angle — which made that impossible — and then marked coincidence
with red dots to compensate. The dots were a patch over a self-inflicted problem
and read as specks. Removing the offset removed the need for them.

## The mixer

`mixer` in the status bar. One strip per place, plus a master strip.

A fader moves **a place as a whole** — the live stream from that microphone *and*
the layers the piece generates from it. That is why the synth routes each voice
through the channel it was built from rather than a shared output: pull Otsuchi
down and its echoes go with it.

| | |
| --- | --- |
| level, pan | the obvious two; solo is subtractive |
| low cut | field microphones always have wind and traffic rumble |
| tone | takes the top off a hissy stream |
| space | sends the place into the same generated room the piece's own layers live in |
| balance | the world against the piece's reply to it — the most musical control here |
| pan by longitude | westmost microphone left, eastmost right |

**Nothing in the mixer touches the analysis.** The analyser and the capture buffer
tap the source node upstream of every control, so mixing changes what you hear and
never what the piece thinks it is hearing. Pull a fader to nothing and the
spectrogram, the pattern matching and the narration carry on.

`pan by longitude` is the one piece of automation that says something true about
the material: the set is chosen to be spread across the planet, so longitude is a
real stereo axis rather than an arbitrary one.

## Red means one thing

Red is the accent, and only the accent: sparks and chord threads in the ridge
view. Vermilion is therefore **last** in `CHANNEL_INKS`, so with the default four
channels the palette is ink, blue, moss, ochre. It used to be third, which meant a
quarter of the drawing was red for reasons of identity while red also signalled
emphasis — two unrelated meanings in one colour.

Sparks are soft-edged and small (`visual.sparkSize`, `sparkAlpha`) so they read as
a glint on a ridge rather than a dot sitting on top of the drawing. Chord threads
sit at `visual.chordAlpha`. If the ridge view still feels hot, those three numbers
are the dial; the brief asks for sparks, so they are softened rather than gone.

## Narration and the map

Figures and Motifs are behind `narration` in the status bar rather than occupying
a permanent rail; the stage gets the room instead. With the panel closed the
button carries a count of what has been written since you last looked, which is
quieter than pulling attention away from the visuals.

The reference rail carries a small **world map**: every live microphone as a faint
mark, the ones playing in their channel's ink and joined to each other, so the
spread the selection works so hard to maximise is visible rather than merely
asserted. Equirectangular, because this is a diagram of relative position rather
than a navigational chart — a straight line between two marks is not a great
circle, but it says "these are far apart" plainly.

The coastline is Natural Earth 1:110m land (public domain), reduced here to 1,364
vertices — enough to recognise a continent at sidebar size and no more. The
reduction is in `src/visual/world-path.js`; note that simplifying a *closed* ring
needs care, since Ramer-Douglas-Peucker handed a ring collapses it to two points
(its first and last vertex are the same point, so every perpendicular distance
computes as zero).

## The library of places

`library` in the Open microphones header opens an index of every live
microphone, grouped by country, with what the contributor called it, who
installed it, and **how far it is from the nearest place already playing** —
which is the number that tells you what adding it would actually contribute.

- **What is playing is pinned to the top**, each with a `take off` control.
  Removing a place is the commonest action and should never mean hunting through
  fifty rows.
- **Search** filters by place, country, person or the contributor's own name for
  the mic. Escape clears the search; Escape again closes the panel.
- **Turn a place off without opening the library at all** — every row in the
  Open microphones list has an `off` control.
- Clicking a place adds it; clicking a live one takes it off. Immediately — no
  apply step, no confirmation. `random spread` redraws the whole set, keeping any
  place the new set also wanted.
- A stream that refuses to open is struck through and marked `offline` rather
  than silently failing every time you click it.
- At the six-channel cap, rows that cannot be added say why, and the last
  microphone cannot be removed.

The list is a two-column **grid**, not `columns: 2`. A multi-column block inside
a height-constrained scroller lays its overflow out sideways rather than
downwards, so the library could not be scrolled at all — the rows below the fold
were simply unreachable.

Adding and removing while the piece runs is why channels carry a stable `id`.
Renderer layers and event detectors are keyed on it, not on array position —
keyed on position, a newly added microphone would inherit the previous
occupant's several seconds of history and mid-event detector state the moment
anything was removed. Channel colours come from a free-ink pool for the same
reason: by index they would shuffle on every removal.

The country headings are canonicalised for grouping only — `UK`/`United
Kingdom`, `netherlands`/`Netherlands` and `Polska`/`Poland` each produced two
headings for one country. The microphone's own name, detail and artist are never
rewritten. Catalunya is deliberately left alone: it is not a sovereign state and
mapping it onto one would be a political claim, not a tidy-up.

## Sensitivity, measured

Every number below was measured rather than guessed. 25 s was captured from
Empordà, Chania and Jasper Ridge and pushed through this project's own band code
(`ffmpeg` to PCM, then a small FFT — see the note at the end of this section).
What that showed:

- The **median band value is 0** on all three streams: more than half of every
  spectrum sits at the absolute floor. Real field recordings are mostly silence.
- Peaks are low — −24 to −37 dBFS — and per-bin medians sit near −105 dB.
- Two of the three are **band-limited by their codec**, one as low as 12.4 kHz.

So:

- **The dB window.** `-92 … -30`. Anything higher clamps the quiet detail away;
  anything lower lifts the hiss into view.
- **A per-place window** (`audio.adaptiveFloor`), because that single window is
  right for an ordinary field recording and useless for a very quiet one. Under
  the floor every band clamps to **zero, and no amount of gain recovers a zero** —
  a hydrophone at slack water draws a blank sheet however hard the trim pushes,
  which is why the trim alone could not fix this. Each place keeps the window's
  *width* (width is contrast) and slides it down onto its own background, measured
  as the 78th percentile of its band peaks with a 12-second half-life.

  The slide is **relative** — by how far a place sits below a reference place
  (`referenceDb`, −84 dB) — and only ever downward, so an ordinary stream keeps
  exactly the look it has now. The obvious alternative is wrong and looks right:
  pinning each place's floor to its own percentile equalises the *fraction* of the
  plot that draws, which is not the same thing, because the configured −92 dB floor
  sits at only the 27th–47th percentile of these streams' band peaks. A band takes
  the peak of its bins, so wide high bands read well above the per-bin median of
  −105 dB the floor was chosen from. Pin a quiet place's floor to its own p78 and
  it draws a fraction of what an ordinary place gets.

  Measured in the harness with one place put 25 dB down: its window slid −26.6 dB
  and its drawn mean went from 0.007 — a blank sheet — to 0.181, against 0.218 for
  an ordinary place beside it. The other two places slid 0 dB.
- **Level matching** (`audio.levelMatch`), which is the same idea for the ears and
  has to be a separate measurement. After the window, a hydrophone and a city
  square report the same band levels, so the drawing's numbers can say nothing
  about how loud a place actually *is*; the match works from absolute dB, taken
  before any window. It is a makeup gain on the live path only — never on the
  generated layers, whose level the piece already chose — sitting upstream of the
  faders and downstream of the analyser tap, so it can change what you hear and
  never what the piece thinks it is hearing.

  The target (−78 dB) is the median of what the three calibrated places settle at,
  so the middling place is untouched, the loudest is trimmed a little and the
  quietest lifted a lot (caps: +18 / −6 dB). An early **unsettled** reading
  suggested −70, which would have lifted everything 8 dB — a volume increase
  dressed up as normalisation. Silence is **held, not lifted**: below −112 dB the
  gain stays where it is, because hauling a dropped stream up 18 dB and dropping it
  again when it returns is pumping. Each mixer strip shows its own gain in dB, and
  `match levels` in the mixer header turns the whole thing off.
- **A display tilt** (`audio.tiltDbPerOctave`, 5 dB/octave above 250 Hz). This is
  why the plot used to hug its left edge: natural sound rolls off with frequency,
  so on a flat spectrogram the top four octaves are present but too quiet to
  cross the drawing threshold. The tilt only ever boosts, so low-frequency
  material is left exactly as it is rather than scooped out. On the measured
  streams it takes all four quarters of the spectrum from mostly-dead to alive.
- **`fMax` of 10 kHz**, because a shared frequency axis beyond that is dead space
  on at least one layer — and the axis has to be shared, or a chord between two
  layers would not mean the same frequency.
- **Drawing thresholds** (`visual.lineKnee` / `lineFull`) chosen so roughly a
  fifth of the plot draws: 17%, 27% and 23% on the three measured streams. Mostly
  paper, with events standing out. This is the difference between a restrained
  plot and a solid slab, and it cannot be set by eye.
- **Per-channel adaptive trim** (`audio.autoTrim`). The set spans a forest at
  night and a city square at rush hour, and no single sensitivity suits both.
  Each channel is normalised toward a target **mean** band level, rising to a new
  level quickly and falling away slowly, so the estimate tracks what a place is
  like rather than this instant. Slow on purpose: it should read as the piece
  settling into a place, never as pumping. The multiplier appears next to a
  channel's meter once it exceeds 1.5×, so a quiet place looking active is
  explained rather than mysterious.

  It targets the **mean, not the peak**, and it can **attenuate as well as
  boost**. An earlier version did neither: clamped to `[1, max]` and tracking the
  peak, it could lift a quiet forest but had no way to pull down a loud city.
  Running live, Krakow drew 100% of the plot while Yamanashi drew 29%. With the
  trim normalising means, four places measured live sat at 20/42/35/27% with
  trims from 0.44× to 4.32×.

  Because the trim pins every channel's mean to `autoTrim.target`, the drawing
  thresholds are best read as multiples of it — change one and the other needs
  revisiting.
- **The visual response curve** (`visual.knee`, `visual.curve`, `height`). A low
  knee and a gentle exponent let faint detail rise off the paper instead of being
  crushed into the floor.

The trim is measured *before* it is applied, so it reacts to the place and not
to itself.

A warning from experience: `dev/visual-check.html` originally generated spectra
about 25 dB hotter than reality, which made a perfectly good plot look like a
solid slab and sent two rounds of tuning at the wrong end of the problem. Its
levels are now calibrated to the measured streams, and the comment there says so.
If you retune anything in this section, measure real audio first.

## Shading and framing

Bare ridge lines read as a thicket of squiggles with no way to tell one source
from another. Each layer now has a **tint under its ridge** (`visual.shade`),
densest just below the line and fading downward and with age. It stays fully
opaque, because that surface is also what performs the hidden-line removal, and
it shares one threshold with the ridge line so shading never appears under a
ridge that is not itself drawn.

The framing is measured too. `__check.inkBox()` in the dev page reads the drawn
bounding box straight off the framebuffer, which turns "is it centred?" into a
number. Two things came out of that:

- **The camera orbited the world origin while aiming somewhere else**, which
  swung the whole plot sideways across the frame as it moved — the real reason
  everything kept ending up against the left edge. The eye now orbits its own aim
  point, and the plot holds dead centre (0.499) at every phase of the orbit.
- At close range the **newest** row — the widest on screen — was being clipped at
  the sides. A longer lens further back (`fovDegrees` 36, `orbitRadius` 11) fills
  about 83% × 80% of the stage with no clipping at any orbit phase.

The ink box now follows wherever the sound is, which is correct: forcing it to
dead centre would make the plot drift about with the audio.

### Attribution

Every microphone belongs to the person who installed it. Their name is shown in
the Credits block in the sidebar for as long as their stream is in the mix, next
to a link to the soundmap that relays it. If you extend this, keep that.

## What is running

| System | File | What it does |
| --- | --- | --- |
| Registry | `src/audio/sources.js` | Live mic list, normalisation, farthest-point selection, haversine |
| Streams | `src/audio/remote.js` | Holds each open mic open; reconnect, backoff, honest health |
| Unlocking | `src/audio/mediapool.js` | Gesture-primed media elements, so iOS will load a stream at all |
| Graph | `src/audio/engine.js` | Per-channel analyser + rolling capture; the audible live mix |
| Spectrogram | `src/audio/spectrogram.js` | 96 log bands, 45 Hz–16 kHz, 30 fps, ring history |
| Description | `src/audio/features.js` | Duration, attack, centroid motion, flatness, modulation, onset density |
| Recognition | `src/analysis/patterns.js` | 11 described shapes, weighted membership scoring |
| Memory | `src/analysis/motifs.js` | 8×8 shape fingerprints, recurrence, a variation ladder |
| Association | `src/orchestra/associations.js` | Tag graph — shared ground, bridges, oppositions |
| Narration | `src/orchestra/narrator.js` | The figure lines, place, distance, and the arc |
| Conducting | `src/orchestra/conductor.js` | Event → relation → gesture |
| Response | `src/audio/synth.js` | Granular clouds, resonant blooms, swells, motif variations |
| Visualiser | `src/visual/renderer.js` | Stacked ridge layers, sparks, chord threads (WebGL2) |
| Bloom view | `src/visual/bloom.js` | Mirrored radial contours, smoothed in both axes (Canvas2D) |
| Contour view | `src/visual/contour.js` | The plane surveyed as a height field, marching squares chained into smooth polylines (Canvas2D) |
| Loudness | `src/audio/levels.js` | The per-place dB window and the audible level match, both pure |
| Readings | `src/ui/views.js`, `src/ui/viewmenu.js` | What the three views are, and the menu that offers them |
| Map | `src/ui/worldmap.js`, `src/visual/world-path.js` | Where the piece is listening |
| Interface | `index.html`, `css/app.css` | Light-mode Swiss grid |

The streams are **audible**, with the generated layers blooming underneath them
at `audio.liveMixGain`. That is what the brief asks for, and it only became
possible with remote sources: a local microphone in the same room as the
speakers feeds back, so a local channel is analysed but never routed to output.
The feedback watchdog now only arms itself when such a channel exists — ducking
a loud stream would be wrong, because a loud place is just a loud place.

### Recognition

Each completed event is described — how long, how sharp the attack, where its
centre of gravity sits and whether it moves, how noise-like it is, how fast it
modulates, how many onsets per second — and scored against every entry in the
library by weighted membership plus a register-profile match. Below the
confidence floor the piece declines to name it and calls it *something unnamed*,
which is still an event.

### Association

Pattern matching says what a sound resembles. The associative layer says what
two sounds might mean *together*: shared tags, an explicit opposition, or a
bridge one or two hops through a small graph of poetic adjacencies. That
relation chooses both the sentence written into **Figures** and the interval the
piece answers with — agreement sounds like agreement, opposition is left
unresolved.

Distance is part of it. When two events come from mics more than
`sources.farApartKm` apart, the line says so, and the partner search actively
favours a distant coincidence over a merely confident local one.

Every line is seeded from the events themselves, so the same coincidence always
produces the same sentence. The world is being read, not randomised.

### Motifs

Shapes are reduced to a mean-removed, normalised 8×8 fingerprint, so loudness
drops out and only shape survives. A shape that returns after being away long
enough is answered with the next rung of a variation ladder — a fifth above,
slowed and reversed, thinned to an outline, doubled underneath, blurred into
weather — and the ladder drifts further out on each pass through. Recurring
shapes are given stable names (*the long shadow*, *the small bell*).

### The visualiser

One layer per microphone, stacked and slightly fanned. Frequency runs across,
time recedes, amplitude rises. Hidden-line removal is done the old way: fill
under each ridge with paper, then draw the ridge on top with a polygon offset —
so silence stays paper and only sound draws. High bands throw vermilion sparks;
low rumble reads as heavy ink.

Where two layers hold energy at the same frequency in the same moment, a
vertical thread is drawn between them: the visual chord, two places meeting in
the same space.

Analysis keeps every frame; the plot draws every third. 168 stacked lines
collapse into a smudge — 56 read as a landscape.

## Tests

```
node test/run.js       # 133 tests, no browser needed
```

The audio graph and WebGL need a browser, but everything that decides what the
piece *thinks* it is hearing is pure and is tested against synthesised
spectrogram shapes — a bird-shaped sweep, walking-pace transients, a sustained
low tone, dense scatter, syllabic mid-band energy. The tests assert the right
name comes back, that fingerprints ignore loudness, that a shape returning is
recognised while an immediate repeat is not, that the association graph finds
real links and refuses invented ones, that selection refuses to cluster even
when the list is mostly one city, that a seed reproduces a set while unseeded
runs differ, that distance reaches the writing, and that narration is
deterministic.

## Visual check without the network

```
http://localhost:4462/dev/visual-check.html
```

Drives the renderer from generated dB spectra so geometry, hidden-line removal,
sparks and chords can be inspected without any stream. In the console:

```js
__check.run(420)        // advance 420 analysis frames synchronously
__check.filledRows(0)   // how much history actually reached the texture
__check.levels(0)       // band-value percentiles, to compare against real streams
__check.inkBox()        // the drawn bounding box, read off the framebuffer
```

`inkBox()` is how the framing was set. Change a camera or geometry value in
`config.js` and re-run it across a few orbit phases rather than judging from a
screenshot.

`run()` exists because a background tab throttles `requestAnimationFrame` to
nothing, which makes the plot look broken when it is fine.

## Checking the interface without audio

The piece cannot be started from an automated browser: a driven tab is
`visibilityState: hidden`, a gesture-less `play()` is refused, and boot correctly
stops there. That leaves the entire interface unjudgeable, which is how a dock
ended up drawn over the one line of text that reports trouble. Three harnesses fill
that gap, none of them shipped.

```js
// In the console on the real page — fills it with a stand-in set, no audio at all.
const m = await import('/dev/fill-frame.js');
await m.fill();                                      // four places
await m.fill({ mics: 6, trouble: true, recording: true });
```

Real coordinates from the soundmap, so the map draws a real spread; fixed levels
rather than random ones, so two screenshots can be compared.

```
http://localhost:4462/dev/widths.html          # 390, 430, 768 and 1280 side by side
http://localhost:4462/dev/widths.html?mics=6&scale=1
```

The layout at four widths, each in a same-origin iframe so the media query and
`100dvh` resolve against a real device box — a window the session cannot resize
does not get a vote. Each frame reports what is cut off and whether anything in the
status bar is under the dock, tested by scrolling to where the page ends and
checking the bar's *content* rather than its box, since the box spans the full width
by design.

```
http://localhost:4462/dev/glyphs.html          # the reference library, at size and 4×
```

Every library entry drawn from its own criteria, idle and matched, next to the
numbers each was read from. It imports the module rather than a copy, so it cannot
go stale while the glyphs are being tuned.

## Tuning

Everything worth changing is in `src/core/config.js` — how many microphones,
band count and range, frame rate, onset sensitivity, motif match threshold,
coincidence window, voice budget, layer spacing, camera orbit, channel inks.

Four that matter most:

- `sources.count` — how many places at once. More is denser and less legible;
  three or four is the sweet spot. `sources.max` is the hard cap.
- `audio.autoTrim.target` — how loud a channel's loud parts should end up.
  Raise it for more presence, or set `enabled: false` for the raw levels.
- `audio.liveMixGain` — the balance between the world and the piece's own reply.
- `detect.fluxOnsetK` — how much of a jump counts as an onset. Field mics are
  noisier than a room; raise it if the piece is twitchy.
- `orchestra.figureCooldownMs` — how often the piece is allowed to say
  something. Raising it makes the work more patient.
