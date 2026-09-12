import type { Pool } from "pg";
import { blockSignatureHash, decodeToken, encodeToken } from "@adc/core";
import type { Scenario, ScenarioCaveat } from "../types/scenario.js";
import type { LayerVerdict, StepResult } from "../types/layers.js";
import { RbaClient } from "../adapters/rba.js";
import {
  MintClient,
  mintOffline,
  fetchRevokedHashes,
  readNewGraphEvents,
  translateGraphEventToPrincipalGraph,
} from "../adapters/adc.js";
import { BrokerSession } from "../adapters/broker.js";
import {
  seedPrincipalGraph,
  evaluateScenarioPolicies,
  hasViolationOfKind,
  createPrincipalGraphReportClient,
  revokeGrantAfterMint,
} from "../adapters/principal-graph.js";
import {
  createPrincipalGraphAuditSink,
  createAdcGraphSink,
} from "../adapters/principal-graph-lib.js";
import { rbaSubject, rbaObject, scoped } from "../scenario/identifiers.js";
import { grantsToRebacTuples, scopeExplicitTuples } from "../scenario/seed.js";

export interface RangeConnections {
  pgPool: Pool;
  rba: RbaClient;
  mint: MintClient;
  mintBaseUrl: string;
  adcRootSecretKey?: Uint8Array; // only needed for adcTokens[].via:'offline' scenarios
  adcRootPublicKey: Uint8Array;
  principalGraphReportBaseUrl: string;
  principalGraphReportApiKey: string;
  mintGraphEventsPath: string;
  /** Byte offset into mintGraphEventsPath already drained by a prior scenario in this
   * same suite run — mutated in place so scenarios sharing one suite run never
   * re-translate the same @adc/graph event into Principal-Graph twice. */
  graphEventsOffset: { value: number };
}

export interface ScenarioRunResult {
  scenario: Scenario;
  steps: StepResult[];
  rebac?: LayerVerdict;
  identityGraph: LayerVerdict;
  /** Set iff expected.rebacListUsers was declared — see that field's own doc comment. */
  rebacListUsersOk?: boolean;
}

/** A scope caveat's `triples[].resourceId` (docs: "resourceId may be '*'") names a resource
 * the same way `stack.grants[]` does — by its logical `externalId` (e.g. "prod-config") —
 * but the actual RBA tuple written for that resource's grant lives under `rbaObject()`'s
 * scoped+sanitized id (src/scenario/identifiers.ts), never the bare externalId. Without
 * this translation, the mint service's own real bounding (services/mint/src/bounding.ts)
 * would ask RBA about a (resourceKind, "prod-config") pair no tuple was ever written under,
 * and every point-scoped mint would fail `scope_not_granted` regardless of whether the
 * grant genuinely exists. `'*'` passes through untouched — RBA's own wildcard sentinel, not
 * a resource reference to resolve. */
function resolveScopeCaveats(
  scenario: Scenario,
  resourcesByExternalId: Map<
    string,
    { kind: string; source: string; externalId: string }
  >,
  caveats: readonly ScenarioCaveat[],
): ScenarioCaveat[] {
  return caveats.map((c) => {
    if (c.kind !== "scope") return c;
    return {
      ...c,
      triples: c.triples.map(([resourceKind, resourceId, relation]) => {
        if (resourceId === "*")
          return [resourceKind, resourceId, relation] as [
            string,
            string,
            string,
          ];
        const resource = resourcesByExternalId.get(resourceId);
        if (!resource)
          throw new Error(
            `scenario ${scenario.id}: scope caveat references unknown resource externalId "${resourceId}"`,
          );
        return [resourceKind, rbaObject(scenario, resource).id, relation] as [
          string,
          string,
          string,
        ];
      }),
    };
  });
}

async function mintScenarioTokens(
  scenario: Scenario,
  conn: RangeConnections,
): Promise<Map<string, string>> {
  const principalsById = new Map(
    scenario.stack.principals.map((p) => [p.id, p]),
  );
  const resourcesByExternalId = new Map(
    scenario.stack.resources.map((r) => [r.externalId, r]),
  );
  const tokensById = new Map<string, string>();
  for (const spec of scenario.stack.adcTokens) {
    if (spec.via === "mint") {
      if (!spec.mint)
        throw new Error(
          `scenario ${scenario.id}: adcTokens["${spec.id}"] declares via:'mint' with no mint block`,
        );
      const principal = principalsById.get(spec.mint.subjectPrincipalId);
      if (!principal)
        throw new Error(
          `scenario ${scenario.id}: adcTokens["${spec.id}"].mint references unknown principal`,
        );
      const subject = rbaSubject(scenario, principal);
      const { token } = await conn.mint.mint({
        subject,
        caveats: resolveScopeCaveats(
          scenario,
          resourcesByExternalId,
          spec.mint.caveats,
        ),
      });
      tokensById.set(spec.id, token);
    } else {
      if (!spec.offline)
        throw new Error(
          `scenario ${scenario.id}: adcTokens["${spec.id}"] declares via:'offline' with no offline block`,
        );
      if (!conn.adcRootSecretKey)
        throw new Error(
          `scenario ${scenario.id}: offline minting needs RangeConnections.adcRootSecretKey`,
        );
      const parsed = mintOffline(
        conn.adcRootSecretKey,
        spec.offline.rootCaveats,
        spec.offline.attenuations,
        {
          sealed: spec.offline.sealed,
        },
      );
      tokensById.set(spec.id, encodeToken(parsed));
    }
  }
  return tokensById;
}

async function revokeDeclaredTokens(
  scenario: Scenario,
  conn: RangeConnections,
  tokensById: Map<string, string>,
): Promise<void> {
  for (const tokenId of scenario.stack.adcRevoked) {
    const wire = tokensById.get(tokenId);
    if (!wire)
      throw new Error(
        `scenario ${scenario.id}: adcRevoked references unknown token "${tokenId}"`,
      );
    const parsed = decodeToken(wire);
    // Revoking the ROOT block (block 0) — every scenario in this corpus revokes the
    // whole delegation, not one intermediate hop; a scenario needing narrower
    // revocation can extend this by indexing parsed.sigs[n].
    const hash = blockSignatureHash(parsed.sigs[0]!);
    await conn.mint.revoke(
      hash,
      `control-coverage-range scenario ${scenario.id}`,
    );
  }
}

/** Drains any new @adc/graph events the mint service wrote since the last scenario run
 * in this suite, translating and feeding each into Principal-Graph's own real
 * createAdcGraphSink() — see taxonomy/gaps/principal-graph.yaml's
 * adc-graph-sink-event-shape-drift row for what this bridge fixes and what it doesn't. */
async function drainAdcGraphEvents(conn: RangeConnections): Promise<void> {
  const { events, newOffset } = readNewGraphEvents(
    conn.mintGraphEventsPath,
    conn.graphEventsOffset.value,
  );
  conn.graphEventsOffset.value = newOffset;
  if (events.length === 0) return;
  const sink = createAdcGraphSink({ pool: conn.pgPool });
  for (const real of events) {
    sink.write(translateGraphEventToPrincipalGraph(real));
  }
  await sink.flush();
}

export async function runScenario(
  scenario: Scenario,
  conn: RangeConnections,
): Promise<ScenarioRunResult> {
  // 1. Identity graph seed — the only way in, absent an HTTP write route (see
  // taxonomy/gaps/principal-graph.yaml's no-write-http-api row).
  const seeded = await seedPrincipalGraph(conn.pgPool, scenario);

  // 2. RBA: publish schema (additive/versioned — a harmless no-op re-publish when two
  // scenarios share the same schema text) and write every derived + explicit tuple.
  if (scenario.stack.rebac.schema) {
    await conn.rba.publishSchema(scenario.stack.rebac.schema);
  }
  const tuples = [
    ...grantsToRebacTuples(scenario),
    ...scopeExplicitTuples(scenario, scenario.stack.rebac.tuples),
  ];
  // One writeTuple() call per tuple hit RBA's own real, documented 20/min POST /tuples
  // budget within a single multi-scenario CI run (confirmed empirically: a scenario with a
  // few dozen tuples exhausted it outright, HTTP 429). POST /tuples/batch exists precisely
  // for this — the same 20/min ceiling but up to 50 tuples per request ("50× more tuple
  // writes/minute, not a loosened write budget," per RBA's own route comment) — so this
  // range now batches, chunked at RBA's own TUPLE_BATCH_MAX_SIZE (50).
  const RBA_TUPLE_BATCH_MAX_SIZE = 50;
  for (let i = 0; i < tuples.length; i += RBA_TUPLE_BATCH_MAX_SIZE) {
    await conn.rba.writeTuplesBatch(
      tuples.slice(i, i + RBA_TUPLE_BATCH_MAX_SIZE),
    );
  }

  // 3. ADC: mint every declared token (real HTTP mint, or offline via @adc/core directly)
  // then revoke whichever ones the scenario declares revoked, in that order — a
  // stale-grant-abuse scenario needs the token to have existed, live, before revocation.
  const tokensById = await mintScenarioTokens(scenario, conn);
  await revokeDeclaredTokens(scenario, conn, tokensById);

  // 3b. Grants revoked AFTER minting — "the token/tuple existed live when it was minted,
  // then the underlying grant was revoked, with ADC never told" (identity#stale-grant-abuse).
  // Both the Postgres grant_edge row and the mirrored RBA tuple are revoked, since a real
  // remediation flow would do both — this scenario shape is precisely about what ADC
  // itself does NOT re-check, not about whether Principal-Graph/RBA can be told correctly.
  const principalsById = new Map(
    scenario.stack.principals.map((p) => [p.id, p]),
  );
  const resourcesById = new Map(scenario.stack.resources.map((r) => [r.id, r]));
  for (const entry of scenario.stack.revokeAfterMint) {
    await revokeGrantAfterMint(conn.pgPool, seeded, entry);
    const principal = principalsById.get(entry.principalId);
    const resource = resourcesById.get(entry.resourceId);
    if (!principal || !resource)
      throw new Error(
        `scenario ${scenario.id}: revokeAfterMint references unknown principal/resource`,
      );
    await conn.rba.deleteTuple({
      objectNs: rbaObject(scenario, resource).ns,
      objectId: rbaObject(scenario, resource).id,
      relation: entry.relation,
      subjectNs: rbaSubject(scenario, principal).ns,
      subjectId: rbaSubject(scenario, principal).id,
    });
  }

  const revokedHashes = await fetchRevokedHashes(
    conn.mintBaseUrl,
    conn.adcRootPublicKey,
  );

  // Any mint/revoke activity above already landed in the mint service's own
  // MINT_GRAPH_EVENTS_PATH (docker-compose sets it — see ARCHITECTURE.md); drain it into
  // Principal-Graph BEFORE the adversary session runs, so a confused-deputy scenario's
  // on-behalf-of grant (this bridge's own fix, see taxonomy row) is live in time to be
  // exercised by a subsequent broker call, not just recorded after the fact.
  await drainAdcGraphEvents(conn);

  // 4. Broker session: one instance = one session = one acting principal, per TTTB's own
  // GAPS.md #19 model. Fan the real audit trail out to Principal-Graph too.
  // (principalsById/resourcesById already built above, for revokeAfterMint.)
  const actingPrincipal = principalsById.get(
    scenario.adversary.actingPrincipalId,
  );
  if (!actingPrincipal)
    throw new Error(
      `scenario ${scenario.id}: adversary.actingPrincipalId references unknown principal`,
    );
  const actingSubject = rbaSubject(scenario, actingPrincipal);
  const onBehalfOfPrincipal = scenario.adversary.onBehalfOfPrincipalId
    ? principalsById.get(scenario.adversary.onBehalfOfPrincipalId)
    : undefined;

  const pgAuditSink = createPrincipalGraphAuditSink({
    pool: conn.pgPool,
    agent: {
      source: actingPrincipal.source,
      externalId: scoped(scenario, actingPrincipal.externalId),
      displayName: actingPrincipal.displayName,
    },
    onBehalfOf: onBehalfOfPrincipal
      ? {
          source: onBehalfOfPrincipal.source,
          externalId: scoped(scenario, onBehalfOfPrincipal.externalId),
          displayName: onBehalfOfPrincipal.displayName,
        }
      : undefined,
    resourceSource: "control-coverage-range",
  });

  const session = new BrokerSession(scenario, {
    rba: conn.rba,
    actingSubject,
    adcRootPublicKey: conn.adcRootPublicKey,
    revokedHashes,
    extraAuditSinks: [pgAuditSink],
  });

  if (scenario.adversary.systemPromptExposureBefore) {
    session.broker.markSystemPromptExposure(
      scenario.adversary.systemPromptExposureBefore.note,
      scenario.adversary.systemPromptExposureBefore.text,
    );
  }

  const steps: StepResult[] = [];
  for (const [stepIndex, step] of scenario.adversary.steps.entries()) {
    if (step.startNewTurnBefore) session.broker.startNewTurn();
    session.currentAdcToken = step.adcToken
      ? tokensById.get(step.adcToken)
      : undefined;
    try {
      const { broker, adc } = await session.callStep(step.tool, step.args);
      steps.push({ stepIndex, tool: step.tool, verdicts: [broker, adc] });
    } catch (err) {
      steps.push({
        stepIndex,
        tool: step.tool,
        verdicts: [],
        threw: {
          className: (err as Error).constructor.name,
          message: (err as Error).message,
        },
      });
    }
  }
  await pgAuditSink.flush();

  // 5. Independent RBA check — the app-level authorization question this range asks on
  // its own, mediated by neither the broker's taint gate nor an ADC token.
  let rebac: LayerVerdict | undefined;
  if (scenario.expected.rebac) {
    const subjectPrincipal = principalsById.get(
      scenario.expected.rebac.check.subjectPrincipalId,
    );
    const objectResource = resourcesById.get(
      scenario.expected.rebac.check.objectResourceId,
    );
    if (!subjectPrincipal || !objectResource) {
      throw new Error(
        `scenario ${scenario.id}: expected.rebac.check references unknown principal/resource`,
      );
    }
    const result = await conn.rba.check({
      subject: rbaSubject(scenario, subjectPrincipal),
      relation: scenario.expected.rebac.check.relation,
      object: rbaObject(scenario, objectResource),
    });
    // This check never gates the step calls above — it is a standalone, after-the-fact
    // question ("would a direct RBA check have denied this"), deliberately never
    // conflated with `denied` (which this range reserves for a layer that actually
    // prevented the call). See src/scoring/score.ts for how this column's outcome is
    // constrained to {observed-only, missed} as a structural consequence.
    rebac = {
      layer: "rebac",
      raw: result,
      denied: false,
      requiresApproval: false,
      observed: true,
      detail: { depth: result.depth, wouldHaveDenied: !result.allowed },
    };
  }

  // 6. Identity graph: any @adc/graph events emitted during the adversary session
  // itself (a verify-deny, say) drain the same way, then evaluate policies.
  await drainAdcGraphEvents(conn);
  const violations = await evaluateScenarioPolicies(conn.pgPool, scenario);
  const expectedKinds = scenario.expected.identityGraph?.violations ?? [];
  const observedExpectedKinds = expectedKinds.filter((k) =>
    hasViolationOfKind(violations, k, scenario),
  );
  // Principal-Graph's report/policy layer has no live gating mechanism at all (confirmed:
  // src/server.ts exposes only GET /health, /report, /report.json) — its column can
  // structurally only ever be observed-only or missed, never blocked/approval/
  // blocked-incidentally. See src/scoring/score.ts for where this constraint is enforced.
  const identityGraph: LayerVerdict = {
    layer: "identity-graph",
    raw: { violations },
    denied: false,
    requiresApproval: false,
    observed:
      observedExpectedKinds.length === expectedKinds.length &&
      expectedKinds.length > 0,
    detail: {
      expectedKinds,
      observedExpectedKinds,
      allViolationKinds: violations.map((v) => v.rule.kind),
    },
  };

  // Supplementary, non-matrix diagnostic assertion — see
  // taxonomy/gaps/rba.yaml's listusers-wildcard-unenumerable-refusal row and
  // Scenario.expected.rebacListUsers's own doc comment for why this doesn't need a full
  // layer-outcome cell of its own: it is a single API-behavior correctness check, not a
  // "which layer caught this attack" question.
  let rebacListUsersOk: boolean | undefined;
  if (scenario.expected.rebacListUsers) {
    const spec = scenario.expected.rebacListUsers;
    const resource = resourcesById.get(spec.objectResourceId);
    if (!resource)
      throw new Error(
        `scenario ${scenario.id}: expected.rebacListUsers references unknown resource`,
      );
    const result = await conn.rba.listUsers(
      rbaObject(scenario, resource),
      spec.relation,
    );
    const isUnenumerable =
      "unenumerable" in result && result.unenumerable === true;
    rebacListUsersOk = isUnenumerable === spec.expectUnenumerable;
  }

  return { scenario, steps, rebac, identityGraph, rebacListUsersOk };
}

export async function fetchPrincipalGraphReportSnapshot(
  conn: RangeConnections,
): Promise<unknown> {
  const client = createPrincipalGraphReportClient(
    conn.principalGraphReportBaseUrl,
    conn.principalGraphReportApiKey,
  );
  return client.fetchReportJson();
}
