# Kaioken

A minimalist gym routine tracker, as an installable Progressive Web App (PWA).
No App Store, no account, no server — your data stays on your phone.

## Features

- Create a routine for today, or schedule it for a future date
- Add exercises freely (with common-name autocomplete)
- Hold an exercise card and drag it to reorder your exercises
- Cardio exercises from the catalog (Running, Treadmill, Cycling, ...) log minutes and distance (km or mi) instead of reps × weight
- Per exercise: any number of sets, reps per set, weight per set
- Weight unit (kg / lb) is chosen **per exercise** — mix freely within one routine
- Warm-up sets: a Warm up button adds warm-ups that group above your working
  sets (new ones append below the last warm-up and copy its values); marked
  with a thermometer icon and excluded from PRs and volume stats
- Live per-exercise stats: Volume, Reps and average weight under each
  exercise, updating as you type
- Start a workout to start the timer (a compact one-line elapsed box);
  finish it to record the duration
- During a workout: exercises fold to slim headers so you focus on one; all start folded - unfold the one you are on, and finishing its sets folds it and unfolds the next
- Tap a set to mark it done (green check + highlight); tap again to undo
- Personal records: the set circle turns into a golden flame the moment its typed values would beat your best (estimated 1RM, warm-ups excluded); marking it done toasts a new PR and keeps the golden highlight
- Automatic rest countdown after each completed set (1 / 1.5 / 2 min, configurable in Settings)
- On finishing a workout: a creatine/protein check-in (yes/no switch) and an optional body-weight entry, saved with the routine
- Eleven color themes (dark, OLED, mono, nord, ocean, forest, violet, ember, ruby, light, paper), switchable in Settings
- Kaioken theme: runs cold and heats up (Kaio-ken ×1–×20) with your last 7 days of training, with a live level chip on Home
- Background styles (Settings): subtle generated texture, or one of your own photos (stored on-device, offline, theme-tinted, Fill or Fit), with frosted cards
- Exercise categories auto-tagged from the built-in catalog (chest, back, legs, ...)
- Stats screen, three tabs — every graph has a time range (Last week, 2
  weeks, 3 weeks, month, 3 months, 6 months, Last year, All time) and all
  its options (chart type, style, range) behind one compact button that
  opens a bottom sheet:
  - Progression: per-exercise **top set weight** per session (heaviest
    working set, warm-ups excluded), spaced by actual date — Line or Bar,
    Discrete dots or Continuous curve with area fill
  - Muscles: training volume by muscle group as a **radar chart** (the
    previous equal range overlaid dashed for comparison, ring scale
    labeled) or the classic heatmap
  - Volume: weekly (or monthly) totals as stacked bars by muscle group or
    a line/area trend; tap a column or point for the breakdown
  - Every value chart shows a Y axis with round tick labels that rescale
    to the data (unit on the top tick; the bar chart's gutter lines up
    with the bars)
- Pin any chart to Home from its options sheet: it stays interactive
  there, its options sheet edits and persists the pin, and tapping its
  title opens Stats on that graph
- Every home section (calendar, pinned chart, New Routine, Active,
  Scheduled, History) is hold-and-drag reorderable; the layout persists
- Rename, repeat or delete any workout (scheduled, active or past) by holding it (or right-clicking): long-press action sheet — or the ⋯ button in the routine view
- Share a finished routine as an image highlight: a 1080×1350 card in your
  theme (top sets, PRs, volume) via the system share sheet, with a
  Save image / Copy text fallback where files cannot be shared
- Change a scheduled or active routine's date from the routine view (completed workouts keep their date)
- Back button / swipe-back work: navigation pushes history instead of exiting the PWA
- History of completed routines grouped by month (collapsible); past workouts are dimmed
- Home: a compact last-7-days calendar strip with a dot on each day you finished a workout (the same 7 days the Kaioken theme watches); tap it to unfold the full month
- Exercise and routine name autocomplete (in-app picker; iOS ignores <datalist>)
- Named Kaioken — installs and displays as "Kaioken"
- Works fully offline (service worker + on-device storage)
- Strict CSP (no inline styles, no third-party sources) and cross-origin
  embedding is blocked
- Backup / restore everything as JSON (in Settings)

## Run locally (development)

Requires Go:

    go run .            # dev server on http://localhost:8080
    go run . icons      # regenerate the app icons

Go is only a local development helper (dev server + icon generator).
The app itself is pure static files — there is no backend.

### Verify before pushing

The browser harness in `tests/` loads the real app, drives it like a user and
checks the DOM, charts, CSP, storage and the share card (92 checks). It is
dev-only tooling: nothing under `tests/` is published.

Requires Node 20+ (once: `npm ci && npx playwright install chromium`):

    npm run verify      # syntax gate + the full harness

That is the exact command CI runs before the GitHub Pages deploy, so a green
local run means the deploy will not be blocked. See `tests/README.md` for the
check inventory and how to add one.

## Put it on your iPhone

The PWA must be served over **HTTPS**. Easiest free option — GitHub Pages:

1. Create a repository (e.g. `gymlog`) and push this project to it.
2. Repo settings: **Pages** → Deploy from a branch → `main` / `(root)`.
3. Your app is now at `https://<user>.github.io/<repo>/`.

(Any static HTTPS host works: Cloudflare Pages, Netlify, etc. Just upload
this project's files as-is.)

Then, on the iPhone:

1. Open the URL in Safari.
2. Tap **Share → Add to Home Screen**.
3. Kaioken appears as an icon and opens full-screen like a native app. It
   works offline.

## How updates work

The service worker uses a **network-first** strategy: when online you always
get the latest files (a plain reload picks up new code), and the cache is only
used as an offline fallback. If you ever serve an old cached copy, reload
twice — the first reload swaps the service worker, the second gets fresh files.

## Where does my data live?

On the phone itself (IndexedDB in Safari's app storage). Why this beats a
hosted database for this app:

- It works with zero signal in the gym.
- No server to run, secure, or pay for. No accounts, no auth.
- Private by default.

The trade-off: the data is tied to the device. iOS can evict the storage of
web apps left unused for a long time, and a lost phone means lost history.
Mitigation: open **Settings** (gear icon, top right) every few weeks, copy
the JSON export somewhere safe, and Import it if you ever need to restore.

If you later want multi-device sync or stronger durability, a small
Go + SQLite backend can sit behind the same UI — the data model in
`js/app.js` is a plain JSON structure that is easy to sync.

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

- Per-exercise history ("retrieve from log", like StrengthLog)
- Optional Go + SQLite sync backend

## Say thanks

If Kaioken saves you a subscription and you want to say thanks, you can
buy the author a coffee: <https://buymeacoffee.com/rabocse>
