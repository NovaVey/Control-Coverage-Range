import type { Scenario } from "../types/scenario.js";

/** Same scenario-id namespacing src/adapters/principal-graph.ts applies to Postgres
 * identity rows, applied consistently to RBA subject/object ids and ADC mint subjects —
 * one shared RBA instance and one shared Postgres instance can host every scenario in a
 * CI run without any of them colliding on the same identifier. */
export function scoped(scenario: Scenario, externalId: string): string {
  return `${scenario.id}::${externalId}`;
}

/** Matches Principal-Graph's own RBA-exporter convention exactly (src/exporters/rba.ts:
 * subjectNs is the fixed constant 'principal', subjectId is `${source}:${externalId}`) so
 * a tuple this range writes directly and a tuple Principal-Graph's own exporter would have
 * produced for the identical grant are byte-for-byte identical. */
export function rbaSubject(
  scenario: Scenario,
  principal: { source: string; externalId: string },
): { ns: string; id: string } {
  return {
    ns: "principal",
    id: `${principal.source}:${scoped(scenario, principal.externalId)}`,
  };
}

/** Matches Principal-Graph's own RBA-exporter convention: objectNs = resource.kind,
 * objectId = `${source}:${externalId}`. */
export function rbaObject(
  scenario: Scenario,
  resource: { kind: string; source: string; externalId: string },
): { ns: string; id: string } {
  return {
    ns: resource.kind,
    id: `${resource.source}:${scoped(scenario, resource.externalId)}`,
  };
}
