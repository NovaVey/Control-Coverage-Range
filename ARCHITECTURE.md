# Architecture

## The four real projects, and what each one actually is

- **Taint-Tracked-Tool-Broker (`broker` column)** — an in-process TypeScript
  library, no server. Wraps each tool call, tracks a scope watermark
  (CLEAN / DERIVED_UNTRUSTED / RAW_UNTRUSTED), and gates privileged calls
  against it via a `PolicyFn` (`defaultPolicy` by default).
- **Principal-Graph (`identity-graph` column)** — one grant graph plus a
  tamper-evident event log. Read-only over HTTP (`GET /health`, `/report`,
  `/report.json`); every write happens via CLI adapter scripts talking
  directly to Postgres. No HTTP write route exists at all.
- **Relationship-Based-Authorization (`rebac` column)** — a Zanzibar-style
  ReBAC check engine. A real Fastify HTTP service (`/check`, `/scope`,
  `/tuples`, `/schema/publish`, ...), Bearer-authenticated.
- **Attenuated-Delegation-Chain (`adc` column)** — biscuit-style attenuable
  capability tokens. `@adc/core` verifies tokens fully offline against
  caveats; `services/mint` is the one place that consults RBA, and only at
  mint time.

## Why git submodules, not npm workspaces

Three of the four (Principal-Graph, RBA, ADC) are consumed as git
submodules under `stack/`, each pinned to a specific commit, built via
`scripts/build-stack.mjs`. RBA is consumed purely over HTTP (its own real
Fastify service, brought up via docker-compose); ADC's `@adc/core` is
imported in-process for offline token operations; Principal-Graph is
imported in-process too, where this range needs its real identity/audit
code (`src/adapters/principal-graph-lib.ts`) — via a single, ordinary
import from its own package root
(`"principal-graph": "file:./stack/principal-graph"` in this range's own
`package.json`), now that Principal-Graph ships a real `src/index.ts`
re-export surface and a fixed
build (`tsconfig.build.json`'s own `rootDir`) that actually produces the
`dist/index.js` its `package.json` already claimed. Before that fix, this
range had no choice but a fragile relative import six levels deep into
`stack/principal-graph/dist/src/...` — that workaround is gone.

The fourth, taint-tracked-tool-broker, started as a plain npm dependency
(it IS a real, published package) and ended up a submodule too, originally
for two confirmed, unrelated reasons documented in
`taxonomy/gaps/tttb.yaml`'s (now-closed)
`principal-feature-unreleased-at-pin-time` row: the published `1.4.0`
predates the `BrokerOptions.principal`
field this range's `rbac-aware` broker policy depends on, and — at the
time — a plain `github:...#<sha>` dependency reference was unbuildable
(npm's git-install path only ran a `prepare` script, this project defined
only `prepack`; and `files` still got applied to a git install, stripping
`src/` before any build could happen). TTTB's own release-hygiene fix
resolved the second reason directly (a real `prepare` script, `src/` added
to `files`) — confirmed working: Principal-Graph's own `package.json` now
depends on TTTB the exact same way, as a plain git dependency pinned to a
commit. This range keeps the submodule regardless, now for a narrower,
still-real reason (typechecking against source, not a built package's
`.d.ts`, and matching this range's other three submodules' own build
step) — and `scripts/build-stack.mjs` asserts this range's own
`stack/taint-tracked-tool-broker` pin matches the exact commit
Principal-Graph's `package.json` itself depends on, so the two can never
silently diverge the way they did before either fix existed.

`.gitmodules` pins every one of the four to an exact commit — a real,
versioned assembly, not a moving target — see GAPS.md #5 for what that
trades away.

## Two columns are diagnostic, two columns gate

This is the single most important design decision in this range, and it's
worth stating precisely because the whole scoring model depends on it:

- **`broker`** and **`adc`** can each independently prevent a call from
  executing, live, in the actual call path a scenario drives. Their
  possible outcomes are the full five: Blocked, Approval,
  Blocked-incidentally, Missed (Approval is `broker`-only — ADC has no
  approval concept).
- **`rebac`** and **`identity-graph`** never gate anything in this range's
  own architecture. `rebac`'s column is an independent `POST /check` this
  range makes itself, after the fact, asking "would a direct authorization
  check right at this call site have caught this" — deliberately never
  wired into the actual tool-call path, because measuring that question
  *separately* from whatever the broker/ADC decided is the whole point:
  it's how a scenario like `wildcard-scope-over-broad-delegation` shows
  that the information needed to deny a call exists in a live, reachable
  service, while nothing in the assembled stack's actual call path ever
  asks it. `identity-graph`'s column is Principal-Graph's own
  `evaluatePolicies()` — the identical function `npm run policy-check`
  runs — checked after a scenario's steps complete. Both columns can
  therefore only ever be **Observed-only** (would have caught it / did
  surface it in a report) or **Missed** (nothing did). `src/scoring/score.ts`
  rejects a scenario that claims `blocked`/`approval`/`blocked-incidentally`
  for either column outright, as a scenario-authoring error — not
  something to reinterpret charitably.

## A scenario's actual lifecycle (`src/runner/run-scenario.ts`)

1. **Seed Principal-Graph** — direct Postgres writes (`ensurePrincipal`/
   `ensureResource`/a hand-matched `grant_edge` upsert), since there is no
   HTTP write route. Every externalId is namespaced
   `${scenario.id}::${externalId}` (`src/scenario/identifiers.ts`) so every
   scenario in a shared-Postgres CI run gets its own, non-colliding
   identity rows.
2. **Publish RBA schema + write tuples** — one derived tuple per live
   grant, using the *same* mapping Principal-Graph's own real RBA exporter
   uses, byte-for-byte (`objectNs = resource.kind`, `objectId =
   "${source}:${externalId}"`, `subjectNs = 'principal'`) — see
   `src/scenario/identifiers.ts`'s `rbaSubject()`/`rbaObject()`. This used
   to need its own sanitization first: RBA's identifier grammar applied the
   same strict, schema-symbol-shaped pattern to `objectId`/`subjectId` as it
   did to namespace/relation names, which every `:`-joined id this real
   exporter produces violates (the now-closed
   `rba-exporter-identifier-grammar-mismatch` row,
   `taxonomy/gaps/principal-graph.yaml`). RBA's own
   D-187/D-190 split that grammar — `objectId`/`subjectId` now go through a
   much looser data-plane check, since an opaque foreign-system id is real
   data, not a developer-authored schema symbol — so a real, unescaped id
   passes directly. Removing this range's own sanitization workaround
   (rather than keeping it "just in case") is deliberate: with it in place,
   this range was never actually testing the byte-for-byte pairing.
3. **Mint/attenuate ADC tokens** — `via: mint` goes through the real HTTP
   mint service (which itself calls RBA's real `POST /scope`/`POST /check`
   to bound the request); `via: offline` calls `@adc/core` directly, for a
   chain shape the real bounded mint would refuse to issue.
4. **`revokeAfterMint`** — revokes a grant (Postgres + RBA tuple) *after*
   it was already used to mint a token, modeling "offboarding happened,
   nobody rotated the credential."
5. **Drain `@adc/graph` events** — the mint service's real
   `MINT_GRAPH_EVENTS_PATH` NDJSON file, translated
   (`src/adapters/adc.ts`'s `translateGraphEventToPrincipalGraph`) into
   Principal-Graph's own `createAdcGraphSink()` shape and fed in — see
   "The adc-graph-sink bridge" below.
6. **Run the adversary session** — one `BrokerSession` (`src/adapters/broker.ts`)
   per scenario: one broker instance, one bound principal, per
   `BrokerOptions.sessionId`'s own "one instance, one session" rule. Every
   gated call's real audit trail is fanned out to Principal-Graph's own
   `createPrincipalGraphAuditSink()` too, so the identity graph sees
   exactly what a real deployment wiring the two together would.
7. **Independent RBA check** (`expected.rebac`) and **re-drain +
   `evaluatePolicies()`** (`identityGraph`) close out the run.

## The adc-graph-sink bridge — a confirmed, not hypothetical, integration gap

`@adc/graph`'s own real `GraphEvent` (occurredAt/principal/resource/
decision/denyReason/taintLabels/reversible/requestDigest) and
Principal-Graph's own `createAdcGraphSink()` consumer
(action/blockId/at/agent/onBehalfOf/outcome/reason/digest) were each
written without the other project in view — Principal-Graph's own file
header says so explicitly, and asks a future integrator to confirm the
shapes match before wiring them together for real. This range is that
confirmation: the two field-name sets are completely disjoint, and
`src/adapters/adc.ts`'s `translateGraphEventToPrincipalGraph()` is the
missing translation neither project ships. One further, narrower
residual survives even after translating field names correctly:
Principal-Graph's own `handle()` hardcodes `kind: 'agent'` for the acting
identity regardless of the real event's own `principal.kind` — so a mint
event's actor (a `kind: 'service'` root key) is recorded as an ordinary
agent. This range's bridge does not paper over that — see
`taxonomy/gaps/principal-graph.yaml`'s `adc-graph-sink-event-shape-drift`
row.

## Why one shared Postgres / one shared RBA instance

CI runs the whole scenario corpus against one docker-compose stack, not a
fresh one per scenario — standing up four real services (two of them with
their own Postgres schema/migrations) per scenario would make a ~20-scenario
run prohibitively slow. The `${scenario.id}::` scoping
(`src/scenario/identifiers.ts`) is what makes that safe: every principal,
resource, and RBA tuple a scenario writes is uniquely attributable back to
it, so `evaluatePolicies()`'s plain-English violation descriptions
(`{rule, description}` — no structured principal/resource reference) can
still be matched to the right scenario by substring, and two scenarios
sharing a resource name like `"prod-config"` never collide.

## docker-compose assembly

One Postgres instance hosts two logical databases (`principalgraph`,
`authz_service` — `docker/create-databases.sh`), since Principal-Graph and
RBA each assume they own their own instance. RBA and Principal-Graph are
each built from their own real `Dockerfile`. ADC's `services/mint` ships
no Dockerfile at all — `docker/mint.Dockerfile` is this range's own,
building the real, unmodified source from the pinned submodule (a
multi-stage build over the whole npm-workspaces monorepo, since `mint`
depends on `@adc/core`/`@adc/graph`/`@adc/revocation` as workspace
packages).

## What this range cannot honestly claim

See [GAPS.md](GAPS.md) — coverage against a named taxonomy is not coverage
against reality, a scripted adversary measures a different thing than a
live model, and every scenario's own claimed outcome was written by
reading source, not by an empirical run (this repository was built in an
environment with no docker daemon available at all). CI's first real run
against this corpus is this project's first actual empirical validation.
