# Contributing

## Build order

The four assembled projects are git submodules (`stack/*`), each with
their own independent `package.json`/lockfile — not npm workspaces of
this repo. `node scripts/build-stack.mjs` builds all four (`npm ci && npm
run build` in each); do this before `npm install` at this repo's own
root, since two of `this range's own dependencies
(`@adc/core`/`@adc/broker`/`@adc/graph`/`@adc/revocation`) are `file:`
references into `stack/attenuated-delegation-chain`'s already-built
`dist/`, and `taint-tracked-tool-broker` is imported directly from
`stack/taint-tracked-tool-broker/dist/` (see ARCHITECTURE.md for why it's
a submodule rather than the published npm package).

```sh
node scripts/build-stack.mjs
npm install --legacy-peer-deps   # see README's own "Known npm quirk"
npm run typecheck && npm test && npm run lint
```

## Adding a scenario

1. Pick (or add) the taxonomy row(s) it demonstrates in `taxonomy/*.yaml`
   / `taxonomy/gaps/*.yaml` — every row cites a real `file:line` in the
   project it's about, in that project's own established citation
   discipline. Don't invent a mechanism; read the actual source first.
2. Write the scenario YAML (see `src/types/scenario.ts` for the full,
   commented schema — it is the single source of truth; there is no
   separate JSON Schema to keep in sync). Look at an existing scenario in
   the same theme directory (`scenarios/injection|identity|delegation|rebac/`)
   for the shape.
3. Every `expected.cells[]` entry needs a `rationale` arguing why that
   outcome is correct — reviewed the same way a corpus case's own `notes`
   field is elsewhere in this ecosystem. A `blocked`/`blocked-incidentally`
   claim on the `broker`/`adc` columns needs a `reasonMatches` pattern
   too (`test/schema.spec.ts` enforces this mechanically).
4. `rebac`/`identity-graph` cells can only ever be `observed-only` or
   `missed` — see ARCHITECTURE.md's "Two columns are diagnostic, two
   columns gate" section. `src/scoring/score.ts` rejects any other claim
   for those two columns outright.
5. If the scenario demonstrates something already fixed/mitigated rather
   than a live gap, leave `assertsKnownGap: false` (the default) — that
   flag exists specifically so the CI regression gate
   (`src/report/baseline.ts`) never flags an already-disclosed,
   deliberately-demonstrated gap getting "worse" as news.
6. Run `npm run range:gaps-coverage` (or just `npm test`, which calls the
   identical check) to confirm every `requiresScenario:true` taxonomy row
   is referenced by at least one scenario.

## Adding a taxonomy row

- `owasp-llm`/`mitre-atlas` rows should only be added if this range's
  four assembled projects have some real observable surface for them —
  see `taxonomy/owasp-llm-top10.yaml`'s own `requiresScenario: false`
  rows for categories deliberately left out-of-scope, with a one-line
  reason each (never silently omitted).
- `gaps/{tttb,principal-graph,rba,adc}` rows must cite the real source
  (`file:line`) the finding comes from, and must be genuinely open (or a
  narrower residual of something otherwise closed) — not restated from
  that project's own "status: built and shipped" history for entries
  that no longer represent a live gap.
- `identity` rows are for cross-project authorization failures none of
  the four projects' own single-layer test suites has any reason to
  contain — see ARCHITECTURE.md.

## Testing this range's own code

`npm test` runs only unit tests against synthetic data (schema
validation, scoring logic, taxonomy loading, the regression-baseline
diff) — no live stack required. A test that needs the real assembled
services (docker compose) belongs behind `RANGE_LIVE_STACK=1` (see
`vitest.config.ts`), run via `npm run range:run` against a real
`docker compose up` stack, not `npm test`.

## Code style

Matches the four assembled projects' own conventions: TypeScript, ESM
(`"type": "module"`), Prettier + ESLint (`typescript-eslint`'s
recommended config), Vitest. `npm run verify` runs the full local gate
(typecheck, build, test, lint, format check) — the same one CI runs.
