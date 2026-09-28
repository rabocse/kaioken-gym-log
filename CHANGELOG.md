# Changelog

All notable changes to Kaioken are documented here. Versions follow
[semver](https://semver.org/). The version lives in three places that are
bumped together on release: `APP_VERSION` (js/app.js, shown in Settings),
the service-worker cache name (sw.js), and the manifest (manifest.webmanifest).
Each release is tagged on main (`v1.1.0`, ...).

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
