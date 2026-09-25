# GymLog

A minimalist gym routine tracker, as an installable Progressive Web App (PWA).
No App Store, no account, no server — your data stays on your phone.

## Features (v1)

- Create a routine for today, or schedule it for a future date
- Add exercises freely (with common-name autocomplete)
- Per exercise: any number of sets, reps per set, weight per set
- Weight unit (kg / lb) is chosen **per exercise** — mix freely within one routine
- Start a workout to start the timer; finish it to record the duration
- Tap a set to mark it done (green check + highlight); tap again to undo
- Automatic rest countdown after each completed set (1 / 1.5 / 2 min, configurable in Settings)
- Eleven color themes (dark, OLED, mono, nord, ocean, forest, violet, ember, ruby, light, paper), switchable in Settings
- Exercise categories auto-tagged from the built-in catalog (chest, back, legs, ...)
- Stats screen, three tabs:
  - Progression: per-exercise line chart of estimated 1RM (Epley), tap a point for its top set
  - Muscles: 12-week training volume heatmap by muscle group
  - Volume: weekly stacked volume bars by muscle group, tap a column for the breakdown
- Repeat a completed routine as a new one (exercises, sets and weights copied, nothing marked done, scheduled for today)
- History of completed routines grouped by month (collapsible); past workouts are dimmed
- Works fully offline (service worker + on-device storage)
- Backup / restore everything as JSON (in Settings)

## Run locally (development)

Requires Go:

    go run .            # dev server on http://localhost:8080
    go run . icons      # regenerate the app icons

Go is only a local development helper (dev server + icon generator).
The app itself is pure static files — there is no backend.

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
3. GymLog appears as an icon and opens full-screen like a native app. It
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
    └── icons/                # generated PNGs (do not edit by hand)

## Roadmap ideas

- Per-exercise history ("retrieve from log", like StrengthLog)
- Optional Go + SQLite sync backend
