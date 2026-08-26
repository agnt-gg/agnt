# Pixel harness

Deterministic before/after screenshots of every screen, so a refactor can prove
it changed no pixels.

```bash
cd frontend
npx vite build                      # the harness photographs dist/
node tools/pixel/shoot.mjs before
# ...refactor...
npx vite build
node tools/pixel/shoot.mjs after
node tools/pixel/compare.mjs before after
```

`shoot.mjs` writes `tools/pixel/shots/<label>/<route>.png` plus a `.txt`
holding the screen's visible text and a structure count. `compare.mjs` reports
a per-route changed-pixel percentage, the bounding box of the change, a
red-highlight diff image, and a **semantic** diff of the text — so "the layout
moved" and "a label disappeared" are separate signals.

## Determinism

Two runs of the same build must diff to **0.000%**. Everything below exists
because it did not, at some point:

| Source of noise | Fix |
|---|---|
| Live `HH:MM:SS` in the header | `clock.install` **and** `clock.setFixedTime` — install alone leaves a clock that ticks |
| `Math.random` in sparklines/gradients | seeded xorshift installed before app code |
| Reveal animations | `animation-duration: 1ms` + **`animation-fill-mode: forwards`**. Setting duration to `0s` with no fill-mode snaps elements back to their *initial* keyframe, so animated labels photograph blank |
| Onboarding modal | `localStorage.hasCompletedOnboarding` — the key `userAuth` actually reads |
| "Show Me Around" coach-marks | `localStorage.tours_enabled = 'false'` |
| Lazy screen chunk lands after settle | settle counts **all** requests, not just `/api/` — the chunk request is what predicts the data fetch |
| Live backend data | every `/api/**` call is answered from `fixtures.mjs` |

## Fixtures

`fixtures.mjs` answers each endpoint with the **envelope its store unwraps**
(`{ agents }`, `{ tools }`, `{ workflows }`, …). A bare array where the store
does `data.agents || []` renders an empty screen that looks like a legitimate
empty state — the most expensive kind of wrong fixture, because the screenshot
still succeeds and the diff still passes.

Run with `--discover` to list any endpoint with no fixture.

## Notes

- Chromium ships unbuilt on this box; the harness launches `channel: 'msedge'`.
- `deviceScaleFactor` is **1**. At 2 every measurement taken off a shot is
  double, and a review argues about density that isn't there.
- The static server lives inside the harness process. Never background a server
  from a chained shell command — the child holds the stdout pipe open and the
  call never returns.
