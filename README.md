# Kaioken

A minimalist gym routine tracker, as an installable Progressive Web App (PWA)
for **iPhone and Android**. No App Store, no account, no server — your data
stays on your phone.

> **Support the project.** Kaioken is free and ad-free, with no account or
> subscription. If it earns a place in your training, you can
> [buy me a coffee](https://buymeacoffee.com/rabocse). Bug reports and pull
> requests are equally welcome.

## Features

### Logging

- Create a routine for today or schedule it for a future date; hold and drag
  exercises — and every Home section — into the order you want.
- Add exercises freely (built-in autocomplete), any number of sets, reps and
  weight per set. Weight unit (kg / lb) is chosen **per exercise**.
- Cardio exercises (Running, Treadmill, Cycling, ...) log minutes and
  distance (km or mi) instead of reps × weight.
- Warm-up sets group above your working sets and are excluded from PRs and
  volume stats.
- Live per-exercise stats (Volume, Reps, average weight) and a weekly muscle
  counter next to the set count — for example "Chest 12/wk", including
  finished workouts and the routine you are logging.
- Start a workout for the elapsed timer; cards fold to slim headers so you
  focus on the current exercise and unfold the next when you finish its sets.
- Tap a set to mark it done. The set circle turns into a golden flame the
  moment your typed values would beat your best, and an automatic rest
  countdown starts (1 / 1.5 / 2 min, configurable).
- On finishing: a creatine/protein check-in and an optional body-weight entry,
  saved with the routine.

### Progress

- History grouped by month, a 7-day calendar strip on Home, and a Kaioken
  theme that runs cold and heats up with your last 7 days of training.
- Stats screen with eight time ranges (last week through all time):
  - Progression: top-set weight or total working reps, line or bars.
  - Muscles: a weighted nine-axis radar comparing the previous equal range.
  - Volume: weekly/monthly totals by muscle group, with a tap-through breakdown.
- Pin any chart to Home; it stays interactive and its options persist.
- Goals for workouts (week/month/year), creatine/protein days, body weight,
  waist and body fat, shown as progress bars on Home.
- Body composition: height, weight, neck, waist and hip with a live US Navy
  body-fat estimate plus fat/lean mass.

### Programs, sharing, data

- Programs group routine templates under one name, show the next workout and
  a done/total chip for the week; tap a routine to schedule it for today.
- Share a finished routine as a themed 1080×1350 image (top sets, PRs, volume)
  through the system share sheet, with Save image / Copy text fallbacks.
- Rename, repeat or delete any workout; change a scheduled or active
  routine's date from the routine view.
- Back up and restore everything (routines, programs, goals, settings) as JSON
  from Settings.

### Look and feel

- Eleven themes: dark, OLED, mono, nord, ocean, forest, violet, ember, ruby,
  light, paper.
- Generated background textures, or one of your own photos (stored on-device,
  offline, theme-tinted, Fill or Fit) with frosted cards.
- Works fully offline; strict CSP with no third-party sources, and cross-origin
  embedding is blocked.
- Back button / swipe-back navigate the app instead of exiting the PWA.

## Install on your phone

Kaioken is a PWA, so it must be served over **HTTPS**. The easiest free option
is GitHub Pages.

### Host it

1. Create a repository (e.g. `gymlog`) and push this project to it.
2. Repo settings: **Pages** → Deploy from a branch → `main` / `(root)`.
3. Your app is now at `https://<user>.github.io/<repo>/`.

Any static HTTPS host works too (Cloudflare Pages, Netlify, ...): upload this
project's files as-is.

### iPhone / iPad

1. Open the URL in Safari.
2. Tap **Share → Add to Home Screen**.
3. Kaioken appears as an icon and opens full-screen like a native app.

### Android

1. Open the URL in Chrome (Edge and Samsung Internet work too).
2. Open the browser menu (**⋮**) → **Install app** (in Chrome) or
   **Add to Home screen**.
3. Kaioken appears in your launcher and opens full-screen like a native app.

The icons are maskable, so Android adapts them to your launcher's shape. On
both platforms the app works offline once installed.

## How updates work

The service worker is **stale-while-revalidate**: every launch is answered
from the offline cache instantly (the gym has no signal), and that copy is
refreshed in the background — the next launch runs the new release. A deploy
installs under a new cache name, so old and new files never mix. To pick up a
deploy immediately, reload twice — the first reload swaps the service worker,
the second gets fresh files.

## Where does my data live?

On the phone itself — IndexedDB in your browser's app storage (Safari on iOS,
Chrome on Android). Why this beats a hosted database for this app:

- It works with zero signal in the gym.
- No server to run, secure, or pay for. No accounts, no auth.
- Private by default.

The trade-off: the data is tied to the device. iOS can evict the storage of
web apps left unused for a long time; Android clears it if you clear the
site's data. A lost phone means lost history. Mitigation: open **Settings**
(gear icon, top right) every few weeks, copy the JSON export somewhere safe,
and Import it if you ever need to restore.

If you later want multi-device sync or stronger durability, a small
Go + SQLite backend can sit behind the same UI — the data model in `js/app.js`
is a plain JSON structure that is easy to sync.

## Development

See [tests/README.md](tests/README.md) for the check inventory and how to add
one. The app itself is pure static files — there is no backend.

### Run locally

Requires Go:

    go run .            # dev server on http://localhost:8080
    go run . icons      # regenerate the app icons

Go is only a local development helper (dev server + icon generator).

### Verify before pushing

The browser harness in `tests/` loads the real app, drives it like a user and
checks the DOM, charts, CSP, storage and the share card (110 checks). It is
dev-only tooling: nothing under `tests/` is published.

Requires Node 20+ (once: `npm ci && npx playwright install chromium`):

    npm run verify      # syntax gate + the full harness

That is the exact command CI runs before the GitHub Pages deploy, so a green
local run means the deploy will not be blocked.

## Project layout

    gymlog/
    ├── main.go               # `serve` (embedded static server) + `icons` commands
    ├── icons.go              # generates the PWA icons (pure stdlib)
    ├── go.mod
    ├── index.html            # app shell + PWA meta
    ├── manifest.webmanifest  # install manifest
    ├── sw.js                 # offline cache (service worker)
    ├── css/style.css
    ├── js/catalog.js         # exercise -> muscle group catalog + chart colors
    ├── js/app.js             # UI + IndexedDB logic
    ├── icons/                # generated PNGs (do not edit by hand)
    ├── package.json          # dev-only: the browser harness entrypoint
    ├── tests/                # browser harness (not published - see tests/README.md)
    └── .github/workflows/    # verify, then deploy the app files to Pages

## Roadmap ideas

- Per-exercise history ("retrieve from log")
- Optional Go + SQLite sync backend
