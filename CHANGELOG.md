# Changelog

All notable changes to Kaioken are documented here. Versions follow
[semver](https://semver.org/). The version lives in three places that are
bumped together on release: `APP_VERSION` (js/app.js, shown in Settings),
`VERSION` (sw.js, names the cache) and the manifest
(manifest.webmanifest). No file's version is ever read over the network,
so an HTTP-cached copy cannot pin a stale release; `npm run verify` fails
if the three drift apart. Each release is tagged on main (`v1.1.0`, ...).

## [1.15.0] - 2026-11-01

### Added
- Proactive PR hint: with a weight entered and reps still empty, the reps
  field shows the best reps ever done at exactly that weight as an amber
  ghost - the number to beat, before typing anything. Same performed-work
  rules as the record flame, keyed in kilograms so unit switches cannot
  blur it, refreshing live as the weight changes.
- Progression charts can plot **total working reps** per session alongside
  top-set weight (Metric toggle in the options sheet, carried by home
  pins).

### Changed
- Every goal is its own home block: workouts, creatine/protein, body
  weight, waist and body fat are five independently reorderable sections
  (a pre-1.15.0 layout expands its single Goals entry in place), and the
  measurement rows just say what is left ("8 kg to go") - the labeled
  scales and category bands carry the current and target values.
- The Muscles tab is radar-only: the heatmap view is removed (option, pin
  path, styles and checks); a pre-1.15.0 heat pin renders the radar.

## [1.14.0] - 2026-10-31

### Changed
- Measurement goal bars are labeled scales now: the value when the target
  was set anchors the 0% end, the target anchors the 100% end, and the
  fill grows between them as the value moves - a weight goal reads
  literally as filling from 110 kg down to 100 kg.
- The body-fat goal bar is a segmented scale of the standard five
  Navy-method categories (essential, athletes, fitness, average, obese;
  sex-specific ranges, colored blue / green / lime / amber / red) with a
  clearly marked current position (white marker) and target position
  (accent marker) on top.

## [1.13.0] - 2026-10-31

### Added
- Body composition (Settings): sex, height, weight, neck, waist and hip
  (women), stored in one profile with a live US Navy body-fat estimate
  and fat/lean mass. The kg/lb and cm/in units now live here and govern
  the profile fields and the goal targets alike.
- Finish-workout prompts are configurable: body weight, waist, neck and
  hip switches (weight and waist on by default). Every prompted value is
  saved with the workout and updates the profile, so body fat and the
  measurement goals follow along without manual re-entry. Neck and hip
  appear in the finished summary when logged.
- Body-fat goal: a target percentage next to the weight and waist
  targets, tracking the Navy estimate. Measurement goals now show their
  progress percentage, and count goals (workouts, creatine/protein) read
  "3/4 · 75%".

### Changed
- Measurement goals read their current value from the body-composition
  profile (falling back to the latest logged value), and their progress
  reference is an explicit snapshot taken when the target changes.
  Existing 1.12.0 goals derive that snapshot once from the log, exactly
  the way progress was computed before, so nothing jumps.

## [1.12.0] - 2026-10-31

### Added
- Waist measurement: an optional field next to body weight in the finish
  sheet (cm/in), saved with the routine, shown in the finished summary,
  and a waist target goal in Settings with the same progress semantics as
  the body-weight goal (latest logged value toward the target, progress
  counted from the day the target was last changed, bidirectional). Both
  measurement goals normalize units, so a goal set in cm reads log-ins
  made in inches and vice versa.

### Fixed
- The body-weight goal's kg/lb unit toggle in Settings converted the
  target value with the wrong operation when switching from lb to kg
  (introduced with goals in 1.11.0); the shared measurement toggle now
  converts correctly in both directions, for weight and waist alike.

## [1.11.0] - 2026-10-31

### Added
- Goals: weekly, monthly and yearly workout targets, weekly and monthly
  creatine/protein day targets (counted per calendar day, so two workouts
  on one day count once) and a body-weight target with a kg/lb unit,
  configured in Settings and shown as progress bars in a reorderable Home
  section. The weight goal tracks the latest logged weigh-in toward the
  target, with progress counted from the day the target was last changed.
- Programs: a named group of routine templates. Create one with New
  Program on Home or Add to Program in a routine's action sheet; copy
  routines in from existing ones (re-copying a name replaces its
  exercises). The Home card shows the program's size, the next routine up
  and a done/total chip for the current week; tapping a routine inside a
  program schedules it for today. Long-press renames, duplicates or
  deletes a program; inside one, long-press moves a routine up or down,
  renames or removes it. Programs are exported and imported alongside
  routines with the same duplicate-id and write-then-merge safety.

### Notes
- Programs live in the settings store: the database schema stays at
  version 2, so a deployed 1.11.0 can be rolled back with a plain git
  revert with zero data hazard.

## [1.10.0] - 2026-10-31

### Changed
- The exercise name now owns its row. The weight/distance unit selector and
  the reorder arrows moved down into the controls row next to "Warm up",
  and while a workout is running the remove button joins them too, leaving
  only the fold chevron and the name in the header. Long catalog names such
  as "Single-Arm Cable Lateral Raise" are readable in full instead of
  clipped to a few characters.
- A running workout shows a compact sticky strip under the title with the
  elapsed clock and Finish / Abandon. It replaces both the date field (not
  editable mid-workout anyway) and the large bottom action bar, freeing the
  bottom of the screen for the exercise list. The finished summary still
  shows the date.
- The rest timer is slimmer (18px digits, 3px progress, smaller skip button)
  and sits at the bottom edge now that the action bar is gone.

## [1.9.1] - 2026-10-31

### Fixed
- Cold starts no longer wait on the network. The service worker serves the
  cached shell instantly and refreshes it in the background
  (stale-while-revalidate) instead of network-first with no timeout race,
  which could hang for tens of seconds on weak signal or behind a captive
  portal before falling back to cache — over a blank screen.
- Deploys can no longer pin stale code through the HTTP cache. The cache
  name is a constant in `sw.js` rather than a manifest fetched at install
  (GitHub Pages serves the manifest with `max-age=600`), and precaching
  bypasses the HTTP cache, so a new release always installs its own bytes.
- Workout durations are measured on a monotonic clock anchored at boot, so
  an NTP correction or timezone jump mid-workout no longer distorts elapsed
  time, the finish-sheet duration or the rest timer.

### Changed
- `img/background.jpg` (the largest asset, unused at the default `off`
  background) is no longer precached; the runtime handler caches it the
  first time the texture background is enabled.
- Cache reads and writes use exact URLs: query-string requests are passed
  through uncached, so variants cannot grow the cache without bound.

### Hardening
- The manifest declares an explicit `id` (`./`), so the app's PWA identity
  does not follow a future `start_url` change.
- The dev server sends `X-Content-Type-Options: nosniff` and the page CSP
  as a response header for HTML, relevant when bound beyond loopback with
  `-addr :8080`.

## [1.9.0] - 2026-10-29

### Added
- Every value chart has a visible Y axis that adjusts to the data: the
  progression and volume-trend charts draw round tick labels (nice 1/2/5
  steps), gridlines and an axis line in a left gutter, with the unit on
  the top tick; the volume bar chart gains a gutter that mirrors the bar
  stack so its ticks line up with the segment tops; the radar shows its
  ring scale. Switching exercise or range rescales the ticks.
- Share highlight: a finished routine becomes a 1080×1350 (4:5) image
  card in the active theme — accent bar, name, date and duration, top
  sets with PR chips, and a volume/sets/PRs panel — shared as a PNG via
  the system share sheet (Instagram-friendly). Where files cannot be
  shared, a sheet offers the preview with Save image and Copy text.
  Entry points: a Share highlight button on completed routines and a row
  in the long-press action sheet.

### Security
- CSP hardened: `base-uri 'none'`, `object-src 'none'` and
  `form-action 'self'` added, and `style-src` dropped `'unsafe-inline'`
  — all generated inline styles are now painted through the CSSOM from
  data attributes. Cross-origin embedding is busted (same-origin frames
  are allowed; blocked navigations hide the document instead), since
  `frame-ancestors` cannot be expressed in a meta CSP and Pages cannot
  set response headers.

## [1.8.1] - 2026-10-29

### Fixed
- Sheets cap at the viewport height (dvh with a vh fallback) and scroll
  internally. Since 1.8.0's week ranges, chart options sheets stack about
  a thousand pixels of groups; the sheet anchored to the bottom edge ran
  past the top of the screen and nothing could scroll. While the on-screen
  keyboard lifts a sheet it now also shrinks to the visible area, so the
  lifted sheet scrolls instead of pushing its top off-screen.

## [1.8.0] - 2026-10-29

### Added
- Date editing: scheduled and active routines show a date field right under
  the routine title — change it to move a routine between today and
  upcoming (the action bar flips between Save Routine and Start Workout),
  and it saves immediately. Completed workouts keep their date immutable
  so history and stats stay stable.
- Stats ranges gain Last week, Last 2 weeks and Last 3 weeks — the
  volume/heatmap charts already bucket weekly for short ranges, so a week
  is a couple of readable bars.
- The routine view topbar gets a visible ⋯ button that opens the routine
  action sheet (Rename / Repeat as New / Delete) — those actions no longer
  hide behind a long-press nobody discovers.
- Real back navigation: view changes push history entries, so the hardware
  Back button and iOS swipe-back return to where you were instead of
  exiting the PWA.
- Persistent storage: the app requests `navigator.storage.persist()` at
  startup and the Settings backup card reports whether the grant landed.
- Boot skeleton: the shell paints a static Kaioken wordmark while app.js
  boots instead of a blank screen.

### Fixed
- iOS/touch polish batch: every interactive control meets a 44px minimum
  tap target (set circles, delete buttons, segment buttons, calendar nav,
  heatmap cells, warm-up toggle) with visible `:active` press feedback;
  taps skip the double-tap-zoom wait (`touch-action: manipulation`) while
  pinch-zoom keeps working; sheets contain their own scroll and the main
  scroller no longer chains overscroll into pull-to-refresh.
- The exercise header row wraps on narrow screens instead of squeezing the
  name, unit toggle and delete button onto one cramped line.
- The on-screen keyboard no longer covers bottom sheets: while a sheet is
  open, `visualViewport` events measure the overlap and lift the sheet
  clear of the keyboard.
- The storage-failure banner pads below the iOS status-bar inset, so its
  text no longer renders behind the clock / Dynamic Island.
- The radar chart legend names the range actually selected (Last month,
  Last 3 weeks, ...) instead of the generic "selected range".

### Accessibility
- Sheets are real modal dialogs: `aria-modal` plus `#app` made inert
  while open, so screen readers and Tab cannot wander into the page
  behind them.
- Toasts announce themselves (`role="status"`, `aria-live="polite"`), and
  the calendar fold is a real keyboard target (tabindex, role, Enter/Space
  with `aria-expanded`).
- The tiniest text is raised to an 11px floor (radar labels, calendar
  weekday letters, chart column labels), and a `prefers-reduced-motion`
  rule disables animations for people who asked for that.
- Settings no longer serializes the entire routine store (photo payloads
  included) into the DOM on every visit: the export textarea starts empty,
  a Generate button builds the backup on demand, and Copy builds it first
  if needed.
- Dropped the manifest's maskable icon entries — the icons have no
  maskable safe zone, so Android circle-cropping them looked worse than
  the any-purpose art.

## [1.7.2] - 2026-10-15

### Fixed
- Import hardening: the routine's own `id` is validated like every nested
  id (numeric ids created dead entries, object ids aborted the import with
  a DataError), same-backup duplicates get a fresh identity, a failed
  write is reported in an alert sheet instead of vanishing silently on
  the next reload (writes now land in the database before the session is
  mutated), every sheet confirm guards against unhandled rejections, a
  completed routine without a start time no longer renders a ~56-year
  duration, array-typed reps/weights are rejected instead of coerced
  (`Number([5])` is 5), unknown pinned-chart tabs are dropped instead of
  pinning a phantom Muscles chart, and impossible dates (`2024-02-31`)
  fall back to today instead of rolling over into the next month.
- Personal records count performed work only: planned sets in scheduled
  routines no longer raise the PR baseline and strip the flame from real
  lifts, and a set that ties your all-time best keeps the flame on every
  tied set instead of extinguishing all of them (the runner-up now tracks
  the best strictly below the top).
- Deleting a routine from the Home long-press sheet now stops its rest
  timer, like abandon and finish already did.
- A blocked database upgrade (a suspended background tab holding an older
  connection) now rejects with guidance instead of hanging the app on a
  blank screen forever.
- Weight/reps fields reject exponent/hex/junk-suffixed input ("1e3" as
  1000, "0x10" as 0, "10kg" as 10) while keeping the comma-decimal
  locale tolerance from 1.6.1.
- The background-photo gate accepts only the JPEG data URLs the app itself
  creates (the old shape admitted `svg+xml`).
- 12 lines of invalid/dead CSS (merge debris: a selector-less block and
  duplicated rules) removed from the stylesheet.

### Changed
- Routine name length caps unified at 60 characters everywhere.

## [1.7.1] - 2026-10-15

### Fixed
- Every bottom sheet (chart options, confirmations, rename, import,
  finish) was dead since 1.7.0: the new sheet-mounting helper called
  itself instead of attaching the sheet, so tapping those buttons did
  nothing. Reproduced and verified end-to-end in a real headless browser
  (options apply, rename flow) after the fix.
- The long-press sheet (Rename / Repeat as New / Delete) now opens on
  scheduled and active routine entries too, not only on finished ones.

## [1.7.0] - 2026-10-15

### Added
- In-app confirm/prompt/alert sheets replace every native alert/confirm/
  prompt dialog (unreliable in iOS Home-Screen web apps): all delete
  confirmations, routine rename and import feedback now run through the
  app's own bottom sheets.
- Abandon action for active workouts (back to scheduled, nothing logged);
  starting a second concurrent workout asks first.
- Backup envelope now includes settings (theme, rest, background style,
  units, pinned chart, home order - the background photo stays
  device-local); importing previews what will be overwritten before
  writing anything.
- Keyboard access: sheets focus their first control, close on Escape,
  trap Tab and return focus to the trigger; chart points/bars are
  keyboard-operable; exercises move with small up/down buttons.
- Content-Security-Policy meta tag as an XSS backstop for the
  innerHTML-based UI; the dev server now defaults to loopback (127.0.0.1)
  with sane timeouts (use -addr :8080 to bind all interfaces).

### Fixed
- The kg/lb (and km/mi) unit per exercise locks once any set has logged
  values, so history can no longer be silently re-labeled without
  conversion.
- One canonical workout date: finishing stamps the performed day, and the
  calendar, charts and cards all agree (endedAt is duration only).
- Finishing warns when sets with values are not marked done.
- Import sanitizes impossible states (NaN timers, off-canvas chart
  points) by deriving missing timestamps.
- Background photo: EXIF orientation is applied (iPhone portraits render
  upright), non-images are rejected and failures show a toast; the stored
  value is validated as a photo data URL before reaching CSS.

## [1.6.2] - 2026-10-14

### Fixed
- "Repeat as New" copies warm-up flags: duplicated warm-up sets stay
  warm-ups (thermometer icon, excluded from PRs and volume) instead of
  silently becoming working sets.
- The backup sanitizer normalizes the warm-up flag explicitly (and drops
  non-boolean garbage), making the restore contract explicit.

## [1.6.1] - 2026-10-14

### Fixed
- Data safety: deleting a routine also cancels its pending debounced save
  (a deleted routine can no longer resurrect on reload); queued saves are
  flushed when the app is hidden or closed; a stale database connection
  (another tab upgraded it) reopens automatically; and failed writes show
  a banner instead of failing silently.
- Stats: warm-up sets are excluded from the muscle radar, heatmap and
  Volume totals (previously only the per-exercise stats excluded them);
  the live PR refresh numbers sets exactly like the static render
  (thermometer for warm-ups, working-set count otherwise).
- Inputs: ambiguous numbers ("1,234", "1.234,5") and negatives are
  rejected instead of silently parsed as 1.234 or counted as positive
  volume.
- Service worker: the offline cache refresh is chained into the worker's
  lifetime (no more lost background cache writes), and the cache name is
  derived from the manifest version on install - one source of truth, no
  more hand-synced cache constant.
- Performance: keystrokes re-evaluate the PR flame against a per-exercise
  cache instead of rescanning the entire history.

## [1.6.0] - 2026-10-14

### Added
- Pin one chart to Home from its options sheet (chart, style and range are
  part of the pin): the home copy is fully interactive, its own options
  sheet edits and persists the pin, and tapping its title opens Stats on
  that graph.
- Every home section (calendar, pinned chart, New Routine, Active,
  Scheduled, History) is hold-and-drag reorderable like exercise cards;
  the layout persists in Settings.

## [1.5.0] - 2026-10-14

### Added
- Exercise catalog expanded from 95 to 257 entries: cable and rope
  attachment exercises, machines and Smith/landmine variants, kettlebell
  and bodyweight staples, and more cardio options.
- Exercise names are now restricted to catalog entries: typing filters the
  catalog, and the name must be picked from the suggestions or typed as an
  exact (case-insensitive) match - typos like "bice" revert with a hint
  toast instead of being written to the log. Saved history keeps its
  existing names.

## [1.4.1] - 2026-10-12

### Fixed
- Routine long-press sheet gains a Rename option (pencil icon), working on
  scheduled and completed routines alike.
- Stats > Progression: cardio exercises no longer appear in the exercise
  dropdown - they log minutes and distance instead of weight, so their
  chart was empty; a clear message shows if no weight exercises exist yet.

## [1.4.0] - 2026-10-11

### Added
- Stats rework: every graph has a time range (Last month, 3 months, 6
  months, Last year, All time); short ranges bucket by week, long ones by
  month.
- Muscle radar: total volume by muscle group as a radar chart, with the
  previous equal range overlaid dashed for comparison, alongside the
  heatmap view.
- Chart options sheet: one compact button per graph opens a bottom sheet
  with chart type (Line/Bar), style (Discrete/Continuous) and range.

### Changed
- Progression now plots your top set weight per session (heaviest working
  set, warm-ups excluded), spaced by actual date instead of session
  count; Line + Continuous is the default for all charts.
- Volume chart adds a line/area trend of weekly (or monthly) totals on
  top of the stacked bars; Muscles opens on the radar.

## [1.3.1] - 2026-10-11

### Fixed
- Warm-up button: new warm-up sets are added below the existing warm-up
  sets (previously always inserted at the very top of the card) and copy
  the values of the last warm-up set, like the regular + button does.
- Elapsed-time box reduced to a single compact line (clock · start time)
  while a workout is active.

## [1.3.0] - 2026-10-11

### Added
- Live per-exercise stats: Volume, Reps and Average weight update as you type.
- Per-set warm-up sets: add them to the top of an exercise with the Warm up
  button; marked with a thermometer icon and excluded from PR detection and
  volume stats.

### Changed
- Exercise card redesigned as table-style rows: borderless weight/reps inputs
  with visible kg/reps labels and full-bleed separators.
- Delete buttons are now bare "x" icons; the exercise delete is bigger/bolder
  than the per-set delete.
- kg/lb unit toggle moved onto the exercise-name line to save vertical space.
- "+ Add Set" is now a right-aligned "+" icon button.

## [1.2.0] - 2026-09-29

### Added
- Personal records: the set circle turns into a golden flame the moment its
  typed values would beat your best (estimated 1RM); marking it done toasts
  a new PR and keeps the golden highlight.

### Fixed
- Drag reorder: the lifted exercise card was invisible while dragging (the
  ghost inherited the original's hidden state).
- iOS: the date field in New Routine overflowed the card edge (native
  intrinsic width); it now matches the Name field.

## [1.1.0] - 2026-09-28

### Added
- Reorder exercises: hold an exercise card and drag it to a new position.
- Cardio exercises from the catalog (Running, Treadmill, Cycling, ...) log
  minutes and distance (km or mi) instead of reps × weight.
- Finish check-in: when finishing a routine, a sheet asks for creatine/protein
  (yes/no switch, defaults to no, remembers your last answer) and your body
  weight; both are saved with the workout.
- App versioning: version shown in Settings, semver git tags, this changelog.

### Changed
- Set rows show weight first, then reps (82.5 kg × 10) — editor, history and
  stats alike.

### Fixed
- Decimal weights: the weight field accepts decimal values (iOS now shows a
  decimal keypad; comma-decimal locales parse correctly).

## [1.0.0] - 2026-09-28

Initial release: routines with per-set reps/weight tracking, per-exercise
kg/lb, rest timer, exercise catalog with categories and autocomplete,
long-press repeat/delete, stats (progression / muscles / volume), twelve
themes including the Kaioken heat theme, background styles (texture or your
own photo, Fill or Fit), export/import backups, fully offline PWA.
