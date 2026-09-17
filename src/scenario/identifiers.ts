import { encodeIdentityRef } from "@novavey/contracts";
import type { Scenario } from "../types/scenario.js";

/** Same scenario-id namespacing src/adapters/principal-graph.ts applies to Postgres
 * identity rows, applied consistently to RBA subject/object ids and ADC mint subjects —
 * one shared RBA instance and one shared Postgres instance can host every scenario in a
 * CI run without any of them colliding on the same identifier. */
export function scoped(scenario: Scenario, externalId: string): string {
  return `${scenario.id}::${externalId}`;
}

/** Matches Principal-Graph's own real RBA-exporter convention (src/exporters/rba.ts:
 * subjectNs is the fixed constant 'principal', subjectId is `${source}:${externalId}`,
 * now built via `@novavey/contracts`'s `encodeIdentityRef` there too) — byte-for-byte,
 * not up to any sanitization. relationship-based-authorization's tuple-id grammar
 * (src/store/tuples.ts's validateIdentifiers()) used to reject this outright: a
 * data-plane id (objectId/subjectId) went through the same strict IDENTIFIER_PATTERN
 * (`/^[a-z][a-z0-9_]*$/`) as a schema-symbol name (namespace/relation), which every
 * `:`-joined id this exporter produces violates — see the now-closed
 * rba-exporter-identifier-grammar-mismatch row (taxonomy/gaps/principal-graph.yaml) for
 * that history. RBA's own D-187/D-190 split the grammar: objectNs/subjectNs/relation
 * still go through IDENTIFIER_PATTERN, but objectId/subjectId now go through a much
 * looser data-plane check (relationship-based-authorization/src/store/tuples.ts's
 * invalidDataPlaneIdReason(), now published from `@novavey/contracts` too — effectively
 * "no control characters, no '#'/'@', ≤512 chars"), specifically because an opaque
 * foreign-system id like this one is real data, not a developer-authored schema symbol.
 * A real, unescaped id now passes, so this range sends exactly what Principal-Graph's own
 * exporter would — the range is finally testing the real pairing, not a synthetic
 * workaround for an incompatibility that no longer exists. */
export function rbaSubject(
  scenario: Scenario,
  principal: { source: string; externalId: string },
): { ns: string; id: string } {
  return {
    ns: "principal",
    id: encodeIdentityRef({
      source: principal.source,
      externalId: scoped(scenario, principal.externalId),
    }),
  };
}

/** Matches Principal-Graph's own RBA-exporter convention: objectNs = resource.kind,
 * objectId = `${source}:${externalId}` — see rbaSubject()'s own doc comment for why this
 * is now sent unsanitized. */
export function rbaObject(
  scenario: Scenario,
  resource: { kind: string; source: string; externalId: string },
): { ns: string; id: string } {
  return {
    ns: resource.kind,
    id: encodeIdentityRef({
      source: resource.source,
      externalId: scoped(scenario, resource.externalId),
    }),
  };
}
