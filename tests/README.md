# Kaioken browser harness

The app has no build step and no runtime dependencies; this directory is
dev-only tooling that loads the real app in a phone-sized browser and drives
it like a user. Nothing here is published: the deploy workflow copies an
allowlist of app files into `_site/`.

## Run it

    npm ci                        # once (Playwright is the only dependency)
    npx playwright install chromium
    npm run verify                # syntax gate + the full harness

`npm run verify` is the same command CI runs before the Pages deploy; a red
run blocks the deploy. `node tests/run.js` alone skips the syntax gate.
Set `KAIOKEN_HEADED=1` to watch the browser.

## How it works

- `serve.js` serves the repository root on two loopback ports (the second one
  exists so `frames.html` can embed the app from a *different* origin and
  exercise the clickjacking guard). Beacons are answered with 204.
- `driver.html` loads `../index.html` in a 400×800 iframe and drives it with
  real DOM events (pointerdown + click, input, keydown). Every assertion
  reports itself as a beacon request:
  `/tests/beacon/<name>-PASS` or `/tests/beacon/<name>-FAIL--<detail>`.
- `run.js` collects those requests, adds checks that need Playwright
  (cross-origin frame, service worker), prints the failures and sets the exit
  code. On failure it writes `test-results/` (screenshot + JSON) for CI.

Phases share one session in order, so a crash in one phase usually shows up
as cascading failures in the next. Read the first `FAIL` line.

## What is covered (89 checks)

| Phase | Area |
|---|---|
| 1 | boot, catalog, empty state, no JS errors |
| 2 | new routine, name suggestions, create, exercise autocomplete |
| 3 | start workout, fold/unfold, typing sets, stats line, rest timer, add/remove set, cardio layout |
| 4 | finish sheet, body weight/supps, IndexedDB persistence across reload |
| 5 | export shape, settings version line vs manifest version, import merge, bad JSON, duplicate ids |
| 6 | action sheet, gesture lock, Escape, Tab trap, rename, duplicate, delete |
| 7 | stats tabs, exercise selector, bar mode, volume gutter, radar |
| 8 | CSP meta + zero violations, CSSOM-painted data attributes (`.segm`, `.bd-dot`, theme swatches) |
| 9 | chart y-axis ticks/gridlines/unit, rescale on exercise switch, bar-gutter alignment and scaling, range change |
| 10 | share button gating, 1080×1350 PNG, canvas pixels, copy, Escape, scheduled routines excluded |
| 11 | same-origin framing allowed, no errors at exit |
| runner | cross-origin frame guard, service worker registration + cache named from manifest version |

`soft-*` checks are reported as `WARN` and never fail the run; they encode
layout expectations that can differ between machines.

## Adding a check

Add it to the relevant phase in `driver.html` with a unique kebab-case name
and a real assertion, then run `npm run verify`. Prefer observable state
(DOM, computed styles, `getBoundingClientRect`, IndexedDB) over fixed sleeps.
If a phase needs clean state, reload with `loadApp()`; if it must survive a
reload, wait for the write via `waitIdb()` — saves are IndexedDB puts fired
without await and a reload issued too early will outrun them.

Version numbers are never hard-coded: the version check compares the Settings
line with `manifest.webmanifest`, so a release does not break the harness.
