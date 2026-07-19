# Chord Loom

A slow instrument. Build a chord on the keyboard, load it onto one of twelve
pads, and let it bloom — each pad carries its own envelope, tape-loop
memory, filter weather, and breath, all sharing one air of tape echo,
shimmer, and reverb.

Chord Loom began as a SuperCollider GUI instrument (lesson 14b of a
private SC lab) and was rewoven for the browser: held pads are rebuilt as
overlapping retriggered events on [superdough](https://www.npmjs.com/package/superdough),
the sound engine of [Strudel](https://strudel.cc/), vendored here as a
self-contained bundle. No build step, no server — a static page.

Live at [jontoews.com/chord-loom](https://jontoews.com/chord-loom/).

Run locally: any static server (`npm run dev` → http://localhost:8462 —
AudioWorklets require http(s), not file://).

© 2026 Jon Toews · AGPL-3.0 (see LICENSE)
