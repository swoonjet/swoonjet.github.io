// Central tuning. Everything that a future me might want to dial lives here.

export const CONFIG = {
  audio: {
    fftSize: 2048,
    smoothing: 0.45,
    bands: 96,           // log-spaced analysis bands per channel
    fMin: 45,
    // The quietest of the measured streams runs out of codec around 12.4 kHz, so
    // a shared axis beyond ~10 kHz is dead space on at least one layer.
    fMax: 10000,
    frameHz: 30,         // spectrogram frame rate (independent of render rate)
    liveBufferSeconds: 24, // rolling capture used by the granular engine
    liveMixGain: 0.55,   // the open microphones themselves, in the output
    responseGain: 1.0,   // the layers the piece generates from them
    // Every place arrives over this, so nothing ever switches on. Long on purpose:
    // at three seconds the world seems to come up out of the room rather than be
    // dropped into it.
    fadeInSec: 3.0,
    reverbSeconds: 3.4,  // the generated space every strip can send to
    reverbReturn: 0.7,
    geoPanWidth: 0.8,    // how wide "pan by longitude" spreads the set
    // Field microphones are quiet. A city square peaks around -35 dBFS and a
    // hydrophone at night far below that, so the old -95..-18 window mapped
    // almost everything into the bottom fifth of the range and the plot read
    // flat. This 55 dB window is where these streams actually live.
    // Measured, not guessed: 25 s captured from Empordà, Chania and Jasper Ridge
    // and pushed through this same band code. Their per-bin medians sit around
    // -105 dB with p95 near -80, so this 62 dB window is where the material is.
    noiseFloorDb: -92,
    ceilingDb: -30,

    // Per-place window. The floor above is right for an ordinary field recording
    // and useless for a very quiet one: under the floor every band clamps to
    // zero, and no amount of gain recovers a zero — a hydrophone at slack water
    // draws a blank sheet however hard the trim pushes. So each place keeps this
    // window's *width* and slides it down onto its own background.
    //
    // `referenceDb` is what an ordinary stream's p78 band peak measures, and the
    // window slides by however far a place sits BELOW it — never above, so an
    // ordinary stream is untouched. -84 dB was measured, not assumed: the three
    // synthetic places in dev/visual-check.html are calibrated against 25 s
    // captured from Empordà, Chania and Jasper Ridge, and left to settle their
    // estimates read -86, -83.6 and -77.4 dB. The median is the reference, so the
    // middling place is untouched and the slides come out at 0, 0 and -2 dB.
    //
    // Worth writing down, because the obvious alternative is wrong and looks
    // right: pinning each place's floor to its own percentile instead. The
    // configured -92 dB floor sits at only the 27th–47th percentile of those
    // streams' band peaks — a band takes the peak of its bins, so wide high bands
    // read well above the per-bin median of -105 the floor was chosen from. Pin a
    // quiet place's floor to its own p78 and it draws a fraction of what an
    // ordinary place draws. The difference is the thing to follow.
    adaptiveFloor: {
      enabled: true,
      percentile: 0.78,
      referenceDb: -84,
      halfLifeSec: 12,     // what a place is like, not what it just did
      minFloorDb: -125,    // below this is codec dither, not a place
    },

    // Level matching, for the ears rather than the eyes. The window above makes
    // every place's picture comparable; this makes them audible in the same mix.
    // It is a makeup gain on the live path only — never on the generated layers,
    // whose level the piece already chose.
    //
    // Target is in the same domain as the estimate (p90 of band peaks in dB) and,
    // like the floor reference, it is measured rather than chosen. Left to settle
    // for two minutes, the three calibrated places in dev/visual-check.html read
    // -79, -78 and -73 dB; -78 is the median, so the middling place is left alone,
    // the loudest is trimmed a little, the quietest lifted a little, and the piece
    // keeps the overall level it has. Aiming higher than the median would have
    // been a volume increase dressed up as normalisation — worth saying, because
    // an unsettled early reading suggested -70 and would have done exactly that.
    //
    // The caps are asymmetric on purpose: a quiet place may be lifted a long way,
    // a loud one is trimmed only slightly.
    levelMatch: {
      enabled: true,
      percentile: 0.9,
      halfLifeSec: 5,
      targetDb: -78,
      maxBoostDb: 18,
      maxCutDb: 6,
      silenceDb: -112,     // nothing there — hold, do not amplify the dither
      rampSec: 2.5,        // it should read as settling, never as riding a fader
    },

    // Natural sound rolls off with frequency, so a flat spectrogram crams every
    // visible thing into the low bands and the plot hugs its left edge. This
    // reclaims the top octaves. Boost only — the low end is left alone.
    tiltDbPerOctave: 5.0,
    tiltRefHz: 250,

    // Per-channel adaptive trim. The set spans a forest at night and a city
    // square at rush hour, and no single sensitivity suits both.
    //
    // It targets the frame's MEAN, not its peak, because the mean is what decides
    // how much of the plot draws — and it can attenuate as well as boost. An
    // earlier version tracked the peak and was clamped to [1, max], so it could
    // lift a quiet forest but had no way to pull down a loud city: Krakow drew
    // 100% of the plot while Yamanashi drew 29%.
    //
    // Slow on purpose: it should read as the piece settling into a place, never
    // as pumping.
    autoTrim: {
      enabled: true,
      target: 0.20,      // the mean band level every place is brought toward
      minGain: 0.2,
      maxGain: 6,
      floor: 0.015,      // below this a place is silent, not quiet — leave it alone
      halfLifeSec: 9,
    },
  },

  sources: {
    count: 4,            // how many open microphones to listen to at once
    max: 6,              // hard cap — one distinct ink per channel
    listTimeoutMs: 9000,
    maxTries: 6,         // reconnect attempts before a mic is given up on
    farApartKm: 1500,    // beyond this, a coincidence is worth remarking on
    randomStart: true,   // seed the spread randomly so no two sessions match
  },

  history: {
    rows: 168,           // ~5.6 s of spectrogram history at 30 Hz
  },

  detect: {
    fluxOnsetK: 2.1,     // onset threshold = mean + k * mad of recent flux
    minOnsetGapMs: 90,
    maxEventMs: 2200,
    minEventMs: 40,
    releaseRatio: 0.18,  // event ends when level falls below peak * ratio
    sustainedMs: 1100,   // sustained low-flux energy counts as an event too
    minConfidence: 0.42,
    levelFloor: 0.10,    // below this a channel counts as silent, not as an event
    minPeak: 0.24,       // an event that would not even draw is not an event
  },

  motif: {
    fpBands: 8,
    fpFrames: 8,
    matchThreshold: 0.86,
    maxMotifs: 64,
    minGapMs: 4000,      // a motif must be absent this long to count as "returning"
  },

  orchestra: {
    coincidenceMs: 2600, // two events inside this window may form a figure
    figureCooldownMs: 5200,
    tensionDecayPerSec: 0.055,
    maxVoices: 14,
  },

  visual: {
    // Framing was measured, not eyeballed: dev/visual-check.html reads the drawn
    // bounding box straight off the framebuffer, and these values fill about
    // 83% x 84% of the stage at every phase of the orbit without any edge
    // clipping. Change one and re-run __check.inkBox() rather than guessing.
    layerGap: 1.35,      // vertical distance between channel layers
    yawPerChannel: 3.0,  // degrees of fan between layers
    width: 5.6,
    depth: 4.4,
    height: 1.3,         // gap/height = 104%, so only the loudest events graze
                         // the layer above — the breakthrough is kept, just rare
    // Analysis keeps every frame; the ridge plot draws every Nth. 168 stacked
    // lines collapse into a smudge — 56 read as a landscape.
    rowStride: 3,

    orbitPeriodSec: 96,
    orbitDegrees: 15,
    orbitRadius: 11,     // a long lens: at close range the newest row, which is
    orbitElevation: 30,  // the widest on screen, gets clipped at the sides
    aimFactor: 0.20,     // fraction of `height` the camera aims at, above y=0
    fovDegrees: 36,

    sparkBand: 0.55,     // bands above this fraction can throw sparks
    sparkThreshold: 0.48,
    sparkSize: 3.2,      // sparks are an accent, not a scatter of confetti
    sparkAlpha: 0.42,
    chordThreshold: 0.30,
    chordAlpha: 0.30,
    chordRows: 48,
    chordMax: 260,

    // Shader response curve. A low knee and a gentle exponent let faint
    // field-recording detail rise off the paper.
    knee: 0.02,
    curve: 1.15,
    shade: 0.30,         // tint under each ridge — gives layers form, not squiggles
    // Now that the trim pins every channel's mean band level to
    // `audio.autoTrim.target`, these are best read as multiples of it: the knee
    // sits a little above the mean, so a place's steady background stays paper
    // and only what rises above it draws. Measured live, this lands around a
    // fifth of the plot.
    lineKnee: 0.235,
    lineFull: 0.45,
  },

  // The bloom view: the same data read as something growing.
  //
  // Stroke-led on purpose. An earlier version filled every ring, and fourteen
  // filled rings per channel in multiply stack into a solid disc — a blob, not a
  // bloom. What makes this kind of image beautiful is many fine nested contours
  // over a lot of paper, so the fills are gone and the line does the work.
  bloom: {
    rings: 32,           // contours per channel, spread across the whole history
    samples: 140,        // points around each contour before bezier smoothing
    timeSmooth: 2,       // frames either side, for the rolling mean
    innerRadius: 0.10,   // newest contour: events are born at the centre
    outerRadius: 0.86,   // oldest contour, and they ripple outward as they age
    swell: 5.0,          // how far a loud band bulges, in multiples of the gap
                         // between contours — >1 lets neighbours interleave
    strokeNew: 0.34,     // ink for the newest contour
    strokeOld: 0.10,     // ...and for the oldest
    lineWidth: 1.0,
    coreAlpha: 0.035,     // one soft fill, on the newest contour only
    turnPeriodSec: 150,  // one very slow turn, eased at both ends
    turnDegrees: 26,
    // No angular offset between channels, deliberately: sharing one mapping is
    // what makes the same frequency land at the same angle everywhere, so a
    // coincidence between two places reads as aligned swells. Texture comes from
    // the radial stagger instead.
    channelStagger: 0.34,  // fraction of a contour gap each channel is offset by,
                           // so their contours interleave and beat against each other
    breathDepth: 0.16,   // how much the whole field swells with the world's level
  },

  // The contour view: the frequency/time plane surveyed as a height field.
  contour: {
    // Levels are multiples of the trim target, so they follow the normalisation
    // rather than being fixed to absolute loudness.
    levels: [0.20, 0.27, 0.35, 0.45, 0.57, 0.72],
    rowStride: 2,        // history rows per grid row
    blur: 2,             // separable passes; without this it is a thicket of noise
    margin: 0.06,
    lineWidth: 1.05,
    alphaLow: 0.20,      // the outermost, quietest contour
    alphaHigh: 0.58,     // the innermost, loudest

    // Four measures against jitter, which was this view's real problem. It was
    // not noise — it was that everything about the drawing was quantised:
    //
    // 1. The sheet scrolls continuously. History advances at 30 Hz and a grid row
    //    is `rowStride` frames wide, so without this the whole image jumped up
    //    half a row 30 times a second. `scroll` slides it by the fraction of a
    //    frame that has actually elapsed.
    scroll: true,
    // 2. A grid row is the MEAN of the frames it covers, not the one frame that
    //    happened to be sampled. Point-sampling a 30 Hz field at 15 Hz aliases,
    //    and aliasing on a contour plot looks like islands blinking.
    decimate: true,
    // 3. The field itself eases toward what it is being told, rather than being
    //    replaced. At 110 ms the ink lags about a grid row and a half — enough
    //    that a band hovering at a level stops flickering across it, little
    //    enough that a real transient still arrives as a transient. New material
    //    grows in at the "now" edge instead of appearing.
    settleMs: 110,
    // 4. Contours are traced as whole polylines and cut smooth, instead of being
    //    emitted as loose segments. Chaikin, twice: enough to lose the staircase
    //    of the marching grid, not enough to lose a ridge's shape.
    smoothPasses: 2,
    minCells: 2.4,       // shorter than this is a speck, not a landform
  },

  safety: {
    masterGain: 0.34,
    howlDb: -6,          // sustained narrow-band peak above this ducks output
    howlDuckMs: 900,
  },
};

// Channel inks.
//
// Vermilion is last on purpose. It is the accent — sparks, chord threads — and
// giving it to a channel as well meant red carried two unrelated meanings at
// once, so a quarter of the drawing read as emphasis when it was only identity.
// With the default four channels the palette is now ink, blue, moss, ochre, and
// red means one thing only.
export const CHANNEL_INKS = [
  { name: 'ink',       rgb: [0.09, 0.09, 0.07] },
  { name: 'blue',      rgb: [0.10, 0.24, 0.66] },
  { name: 'moss',      rgb: [0.22, 0.40, 0.28] },
  { name: 'ochre',     rgb: [0.62, 0.45, 0.07] },
  { name: 'slate',     rgb: [0.36, 0.38, 0.42] },
  { name: 'vermilion', rgb: [0.85, 0.24, 0.09] },
];
