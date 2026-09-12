# GAPS.md — Known Limitations of Control-Coverage-Range

This range exists to stop the four assembled projects (and, ultimately,
itself) from grading their own homework. In that spirit, this document
applies the identical discipline `taint-tracked-tool-broker`'s own
GAPS.md applies to itself: named plainly, with a taxonomy row
(`taxonomy/gaps/control-coverage-range.yaml`) for each entry below, rather
than left to be discovered after the fact.

## 1. Coverage against a named taxonomy is not coverage against reality

Every cell in the matrix is scored against a technique this project chose
to name and give a scenario to. OWASP LLM Top 10 and MITRE ATLAS anchor
that choice externally so it isn't purely self-serving, but neither
taxonomy is exhaustive, and a real attacker is not obligated to attack in
a way any named technique describes. A fully green matrix is evidence the
named rows are covered, never evidence nothing else is possible.

## 2. A scripted adversary measures a different thing than a live model does

Every scenario's `adversary.mode` defaults to `'scripted'` — a fixed,
deterministic sequence of tool calls, for the same reason
`taint-tracked-tool-broker`'s own injection corpus is fixed and
deterministic: CI needs a stable, reproducible signal, and a live model's
own variance would make the regression gate
(`src/report/baseline.ts`) meaningless run to run. `adversary.mode:
'live-model'` exists in the schema precisely so this isn't silently
conflated with the scripted result — it would answer "would a real,
unscripted model reach the same tool calls," a genuinely different
question than "does the stack correctly gate this exact call sequence" —
and it is never wired to anything in this build; no scenario in this
corpus uses it, and it is never used for regression gating.

## 3. Whoever writes scenarios is biased toward ones their own stack passes

A project's own test corpus tends to reflect what its author already
thought to defend against — the same self-selection risk
`taint-tracked-tool-broker`'s own GAPS.md #29 names for its injection
corpus. Mitigated the same way that corpus mitigates it: every entry in
`taxonomy/gaps/*.yaml` (pulled from each assembled project's own real
source, read directly by this range's own author — none of the four
projects except TTTB actually ships a published GAPS.md at the commit
this range vendors) is required to have at least one scenario that
references it — checked mechanically by `test/taxonomy.spec.ts` /
`npm run range:gaps-coverage`, not left to reviewer attention. This closes
the "did we forget to write the scenario for an inconvenient finding"
half of the bias; it does nothing for the harder half — a gap none of the
four projects' own authors have published yet, that this range's own
author also didn't think to add.

## 4. This corpus's expected outcomes were derived by reading source, not by an empirical run

The environment this range was built in has no running docker daemon, so
no scenario in this initial corpus was run end-to-end against the real
assembled stack before being committed — every `expected.cells` outcome is
this range's author's own careful reading of the four projects' real
source (cited per-scenario, per-taxonomy-row), not a confirmed empirical
result. `.github/workflows/range.yml` runs the whole corpus against a real
docker-compose stack on every push — its first run against this corpus is
this project's first actual empirical validation, and any scenario whose
asserted outcome turns out wrong is expected to surface there (as a hard
CI failure via `src/scoring/score.ts`'s own validation), not be silently
assumed correct because it was never contradicted. One category found
this way already, before any live run: the `taint-tracked-tool-broker`
dependency itself turned out to be pinned to a commit past what's
published on npm, and a naive fix (a plain git dependency) turned out to
be unbuildable — see `taxonomy/gaps/tttb.yaml`'s
`principal-feature-unreleased-at-pin-time` row for the full account. That
one WAS caught before commit, by actually building the stack in this
sandbox — the remaining ~20 scenarios' behavioral claims were not
similarly build-verified, since that requires the full docker-compose
stack, not just `tsc`.

## 5. The matrix reflects one pinned commit of each sibling project, not their current HEAD

`stack/*` are git submodules, each pinned to a specific commit — a real,
versioned assembly, not a moving target that could silently drift
mid-run. But it also means a fix or regression landing on any sibling
project's own main branch is invisible to this matrix until someone bumps
that submodule pointer. This is a deliberate reproducibility trade, not
an oversight, but worth naming: "the range says X is covered" is scoped
to the pinned commits recorded in `.gitmodules` at the time the matrix
was generated.

## 6. Every other finding has its own home, not repeated here

This project pulled a substantial number of concrete, cited findings out
of reading the four assembled projects' real source directly — an ADC
`scope` caveat's wildcard matching any resourceId at verify time
(`taxonomy/identity-controls.yaml`'s `over-broad-delegation`), the fact
that `wrapWithAdcGate()` cannot verify a `scope` caveat at all
(`taxonomy/gaps/adc.yaml`), the `adc-graph-sink` event-shape mismatch
between Principal-Graph and `@adc/graph` (`taxonomy/gaps/principal-graph.yaml`),
and others. Those are findings ABOUT the four assembled projects, not
about this range itself, so they live in `taxonomy/gaps/{tttb,principal-graph,rba,adc}.yaml`
and their own scenarios, per ARCHITECTURE.md — this file is deliberately
scoped to what this range itself cannot honestly claim, not a second copy
of everything it found.
