# Changelog

All notable changes to Kaioken are documented here. Versions follow
[semver](https://semver.org/). The version lives in three places that are
bumped together on release: `APP_VERSION` (js/app.js, shown in Settings),
the service-worker cache name (sw.js), and the manifest (manifest.webmanifest).
Each release is tagged on main (`v1.1.0`, ...).

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
