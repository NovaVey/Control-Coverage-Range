import type { Pool } from "pg";
import type { Scenario } from "../types/scenario.js";
import { scoped as scopedExternalId } from "../scenario/identifiers.js";
import {
  ensurePrincipal,
  ensureResource,
  evaluatePolicies,
  POLICIES,
  type PolicyRule,
  type PolicyViolation,
} from "./principal-graph-lib.js";

/**
 * Every principal/resource externalId this range seeds is namespaced by scenario id
 * (`${scenario.id}::${externalId}`, src/scenario/identifiers.ts's scoped()) —
 * Principal-Graph's own identity key is `(source, external_id)` (src/upsert.ts), and this
 * range's own CI runs the whole scenario corpus against ONE shared Postgres instance, not
 * a fresh database per scenario (see ARCHITECTURE.md's "Why one shared database"
 * section). Without this, two scenarios that both seed a principal called "alice" would
 * collide on the same row and contaminate each other's identity-graph results; with it,
 * every evaluatePolicies() violation's description (a plain English sentence naming the
 * principal/resource by this exact externalId — see policies.ts's own resolveName()) is
 * unambiguously attributable back to the one scenario that produced it.
 */
export { scopedExternalId };

export interface SeededIds {
  principalIdByRef: Map<string, string>; // scenario-local principals[].id -> Principal-Graph uuid
  resourceIdByRef: Map<string, string>; // scenario-local resources[].id -> Principal-Graph uuid
}

/**
 * Writes a scenario's principals/resources/grants directly into Principal-Graph's own
 * Postgres schema, replicating the exact upsert pattern every one of that project's real
 * adapters uses (src/upsert.ts's ensurePrincipal/ensureResource for identity; the same
 * on-conflict grant_edge pattern mcp-config.ts/adc-graph-sink.ts use for grants) — there
 * is no HTTP write route to seed through instead (taxonomy/gaps/principal-graph.yaml's
 * no-write-http-api row).
 */
export async function seedPrincipalGraph(
  pool: Pool,
  scenario: Scenario,
): Promise<SeededIds> {
  const principalIdByRef = new Map<string, string>();
  for (const p of scenario.stack.principals) {
    const id = await ensurePrincipal(pool, {
      kind: p.kind,
      source: p.source,
      externalId: scopedExternalId(scenario, p.externalId),
      displayName: p.displayName ?? null,
    });
    principalIdByRef.set(p.id, id);
  }

  const resourceIdByRef = new Map<string, string>();
  for (const r of scenario.stack.resources) {
    const id = await ensureResource(pool, {
      kind: r.kind,
      source: r.source,
      externalId: scopedExternalId(scenario, r.externalId),
      displayName: r.displayName ?? null,
    });
    resourceIdByRef.set(r.id, id);
  }

  for (const g of scenario.stack.grants) {
    const principalId = principalIdByRef.get(g.principalId);
    const resourceId = resourceIdByRef.get(g.resourceId);
    if (!principalId || !resourceId) {
      throw new Error(
        `scenario ${scenario.id}: grant references unknown principal/resource id`,
      );
    }
    // Matches the exact on-conflict pattern every real adapter uses (verified against
    // src/adapters/mcp-config.ts and src/adapters/adc-graph-sink.ts) — see
    // schema/010_grant_edge_observed_split.sql for why changed_at only bumps on a real
    // create/reinstate transition, never on every re-observation.
    await pool.query(
      `insert into grant_edge (principal_id, resource_id, relation, source)
       values ($1, $2, $3, $4)
       on conflict (principal_id, resource_id, relation, source) do update
         set observed_at = now(),
             revoked_at = null,
             changed_at = case when grant_edge.revoked_at is not null then now() else grant_edge.changed_at end`,
      [principalId, resourceId, g.relation, g.source],
    );
    if (g.revokedAt) {
      await pool.query(
        `update grant_edge set revoked_at = $3
          where principal_id = $1 and resource_id = $2 and relation = $4 and source = $5`,
        [principalId, resourceId, g.revokedAt, g.relation, g.source],
      );
    }
  }

  return { principalIdByRef, resourceIdByRef };
}

/** Revokes a grant that was live (and, typically, already used to mint an ADC token or
 * write an RBA tuple) — models "revoked after the fact," as opposed to grantSchema's own
 * revokedAt (seeded already-revoked, before anything else runs). See
 * Scenario.stack.revokeAfterMint's own doc comment. */
export async function revokeGrantAfterMint(
  pool: Pool,
  seeded: SeededIds,
  entry: { principalId: string; resourceId: string; relation: string },
): Promise<void> {
  const principalId = seeded.principalIdByRef.get(entry.principalId);
  const resourceId = seeded.resourceIdByRef.get(entry.resourceId);
  if (!principalId || !resourceId)
    throw new Error("revokeAfterMint references unknown principal/resource id");
  await pool.query(
    `update grant_edge set revoked_at = now() where principal_id = $1 and resource_id = $2 and relation = $3`,
    [principalId, resourceId, entry.relation],
  );
}

/** Runs Principal-Graph's own real evaluatePolicies() — the identical function `npm run
 * policy-check` invokes — against the default 3 always-on rules plus whatever
 * scenario.stack.principalGraphExtraPolicies opts into. */
export async function evaluateScenarioPolicies(
  pool: Pool,
  scenario: Scenario,
): Promise<PolicyViolation[]> {
  const rules: PolicyRule[] = [
    ...POLICIES,
    ...(scenario.stack.principalGraphExtraPolicies as PolicyRule[]),
  ];
  return evaluatePolicies(pool, rules);
}

/** True iff some violation of `kind` names this scenario (by its scoped externalId
 * appearing in the violation's plain-English description — see PolicyViolation's own
 * shape: {rule, description}, no structured principal/resource reference). */
export function hasViolationOfKind(
  violations: PolicyViolation[],
  kind: PolicyRule["kind"],
  scenario: Scenario,
): boolean {
  return violations.some(
    (v) => v.rule.kind === kind && v.description.includes(scenario.id),
  );
}

export interface PrincipalGraphReportClient {
  fetchReportJson(): Promise<unknown>;
  health(): Promise<boolean>;
}

/** The real, deployed, read-only HTTP report service (src/server.ts) — GET /report.json,
 * Bearer-authenticated (PRINCIPAL_GRAPH_REPORT_API_KEY). Used as supplementary,
 * human-legible evidence attached to a scenario's report (src/report/*), not as the
 * primary identity-graph score input — see this file's own module doc comment on why
 * evaluatePolicies() is the structured signal the scorer actually reads. */
export function createPrincipalGraphReportClient(
  baseUrl: string,
  apiKey: string,
): PrincipalGraphReportClient {
  return {
    async fetchReportJson() {
      const res = await fetch(new URL("/report.json", baseUrl), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok)
        throw new Error(`Principal-Graph GET /report.json: HTTP ${res.status}`);
      return res.json();
    },
    async health() {
      const res = await fetch(new URL("/health", baseUrl));
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    },
  };
}
