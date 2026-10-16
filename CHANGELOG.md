# Changelog

All notable changes to Kaioken are documented here. Versions follow
[semver](https://semver.org/). The version lives in two places that are
bumped together on release: `APP_VERSION` (js/app.js, shown in Settings)
and the manifest (manifest.webmanifest). The service worker derives its
cache name from the manifest's version on install, so the cache can never
drift from the app. Each release is tagged on main (`v1.1.0`, ...).

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
