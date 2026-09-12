# Coverage-matrix baseline

`coverage-matrix.snapshot.json` (not yet present — see below) is the
regression gate's own baseline: `npm run range:check-regression` diffs
the current run's matrix against it and fails on any cell moving to a
strictly worse outcome (`src/report/baseline.ts`'s `findRegressions()`),
except a cell newly marked `assertsKnownGap` or one that was already
flagged invalid in the prior baseline.

No baseline is committed yet — this repository was built in an
environment with no running docker daemon, so no scenario was ever run
end-to-end against the real assembled stack before this initial commit
(see GAPS.md #4). The first successful CI run against this corpus
(`.github/workflows/range.yml`) establishes `coverage-matrix.snapshot.json`
for real, and every run after that compares against it. `npm run
range:check-regression` itself handles the "no baseline yet" case
gracefully — it saves the current run as the baseline rather than
failing.
