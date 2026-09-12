# Control-Coverage-Range

An attack range for the whole agent-security stack. It assembles four real
projects — [Taint-Tracked-Tool-Broker](https://github.com/NovaVey/Taint-Tracked-Tool-Broker)
(the taint-tracking tool-call broker), [Principal-Graph](https://github.com/NovaVey/Principal-Graph)
(the identity/grant graph and tamper-evident event log),
[Relationship-Based-Authorization](https://github.com/NovaVey/Relationship-Based-Authorization)
(the ReBAC check engine), and [Attenuated-Delegation-Chain](https://github.com/NovaVey/Attenuated-Delegation-Chain)
(biscuit-style delegation tokens) — for real, drives a scripted adversary
through the composed system, and reports which layer caught each attack
technique, which layer would have (but wasn't actually consulted), and
which cells nothing covers at all.

Your injection corpus tests the broker alone. Your soundness fuzzer tests
the check engine alone. Nothing tested the assembly — and the interesting
failures in a layered system are the ones where every layer assumed
another layer had it. See [ARCHITECTURE.md](ARCHITECTURE.md) for how the
four projects are actually wired together, and [GAPS.md](GAPS.md) for what
this range itself cannot honestly claim.

## The output

A coverage matrix: rows are attack techniques (anchored externally —
[OWASP LLM Top 10](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/),
[MITRE ATLAS](https://atlas.mitre.org/), each of the four projects' own
published gaps, and five identity-side rows none of those four projects'
own test suites has any reason to contain — stale grant abuse, over-broad
delegation, confused deputy, cross-tenant reachability, group-nesting
escalation), columns are the four layers. Every cell is one of:

| | |
|---|---|
| 🟢 **Blocked** | This layer actually prevented the call, for the right reason. |
| 🟡 **Approval** | This layer gated the call behind human approval. |
| 🔵 **Observed-only** | An independent check would have caught it, or a report surfaces it after the fact — but nothing in the live call path was actually wired to it. |
| 🟠 **Blocked-incidentally** | Something denied the call, but not for a reason related to this technique — reporting this as coverage would be exactly the self-deception this range exists to prevent. |
| 🔴 **Missed** | Nothing caught it. |

`rebac` (an independent RBA check) and `identity-graph` (Principal-Graph's
own policy report) never gate a live call in this range's own architecture
— they can only ever be Observed-only or Missed. `broker` and `adc` are the
two columns that can actually block. See ARCHITECTURE.md's "Two columns
are diagnostic, two columns gate" section for why, and
src/scoring/score.ts for where that constraint is mechanically enforced,
not just asserted in prose.

## Try it yourself

```sh
git clone --recurse-submodules https://github.com/NovaVey/Control-Coverage-Range.git
cd Control-Coverage-Range
node scripts/build-stack.mjs   # builds all four sibling projects
npm install --legacy-peer-deps # see "Known npm quirk" below
cp .env.example .env           # fill in MINT_ROOT_SECRET_KEY_B64, see that file
docker compose up -d postgres
docker compose run --rm migrate-pg
docker compose up -d rba principal-graph mint
npm run range:doctor           # confirms every service is reachable
npm run range:run              # runs the whole scenario corpus, writes .range-out/
npm run range:check-regression # fails if any cell regressed against baseline/
```

Already checked out without submodules? `git submodule update --init --recursive`.

## Known npm quirk

`npm install` alone can crash with `Cannot read properties of null (reading
'edgesOut')` — a real, reproduced `npm`/`@npmcli/arborist` bug resolving
vitest 4's own peer-dependency graph, not something specific to this repo.
`npm install --legacy-peer-deps` works around it; CI uses the same flag.

## Repository layout

```
stack/               git submodules — the four real projects, each pinned to a specific commit
taxonomy/            the external taxonomy (OWASP LLM Top 10, MITRE ATLAS) + each project's own GAPS rows + identity rows
schema/              (scenario shape lives in src/types/scenario.ts — the single source of truth; see that file)
scenarios/            the scenario corpus — one YAML file per attack, organized by theme
src/
  types/              Scenario/Layer/Outcome/Taxonomy types (zod schemas)
  taxonomy/           loads taxonomy/*.yaml, the gaps-coverage check
  scenario/           scenario file loader, RBA-identifier scoping helpers, grant->tuple derivation
  adapters/           real adapters into each of the four projects (broker, RBA HTTP client, Principal-Graph seed/audit-sink/adc-graph-bridge, ADC mint/revocation)
  runner/             orchestrates one scenario: seed -> mint -> drive adversary steps -> independent checks
  scoring/             validates a scenario's own claimed outcome against the empirical verdicts
  report/              coverage matrix, markdown/JSON renderers, the regression baseline
  cli/                 `ccr run|check-regression|doctor|gaps-coverage`
test/                 unit tests for the harness itself (schema, scoring, taxonomy, baseline, identifiers)
baseline/             the committed coverage-matrix snapshot the regression gate compares against
docker/               this range's own Dockerfile for ADC's mint service (which ships none) + a Postgres init script
```

## Scripted vs. live-model

Every scenario's adversary defaults to `mode: scripted` — a fixed,
deterministic sequence of tool calls, for the same reason the broker's own
injection corpus is fixed and deterministic: CI needs a stable signal.
`mode: live-model` exists in the schema and is never used for the
regression gate — see GAPS.md #2 for exactly what it would and wouldn't
prove.

## License

MIT — see [LICENSE](LICENSE).
