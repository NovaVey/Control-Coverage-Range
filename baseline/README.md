# Coverage-matrix baseline

`coverage-matrix.snapshot.json` is the regression gate's own baseline:
`npm run range:check-regression` diffs the current run's matrix against it
and fails on any cell moving to a strictly worse outcome
(`src/report/baseline.ts`'s `findRegressions()`), except a cell newly
marked `assertsKnownGap` or one that was already flagged invalid in the
prior baseline.

This file only ever moves forward via CI itself, never a manual edit:
`.github/workflows/range.yml`'s "Commit updated coverage baseline +
rendered matrix" step commits whatever `range:check-regression` wrote into
this checkout back to `main`, but only on a `push` to `main` — never on a
pull request, which is judged against main's own last-known-good baseline
and must never be allowed to quietly rewrite it itself. The same step, same
commit, also refreshes `COVERAGE.md` and its embed in `README.md`'s own
"Current coverage matrix" section — this file, `COVERAGE.md`, and that
README section always move together, never independently. (An earlier version of this
workflow ran `range:check-regression` without that commit-back step at
all — every run, PR or push alike, found "no baseline yet" in its own
disposable checkout and silently accepted whatever the corpus produced,
never actually comparing against history. Fixed once this repository's
own first real CI run — see GAPS.md #4 — was already green, which is
exactly the kind of gap this project exists to catch, applied to itself.)
`npm run range:check-regression` itself still handles a genuinely missing
baseline gracefully (saves the current run rather than failing) — that
path now only ever fires for a fork or a fresh clone with no CI history
yet, not for this repository's own `main`.
