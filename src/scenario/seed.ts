import type { Scenario } from "../types/scenario.js";
import type { TupleWrite } from "../adapters/rba.js";
import { scoped, rbaObject, rbaSubject } from "./identifiers.js";

/** Mirrors Principal-Graph's own real RBA-exporter mapping (src/exporters/rba.ts,
 * confirmed directly against that file) exactly: objectNs = resource.kind, objectId =
 * `${resource.source}:${externalId}`, relation unchanged, subjectNs = the fixed constant
 * 'principal', subjectId = `${principal.source}:${externalId}`. A tuple this range writes
 * for a seeded grant is therefore byte-for-byte what Principal-Graph's own real exporter
 * would have written for the identical grant, once externalIds are scoped identically
 * (src/scenario/identifiers.ts). */
export function grantsToRebacTuples(scenario: Scenario): TupleWrite[] {
  const principalsById = new Map(
    scenario.stack.principals.map((p) => [p.id, p]),
  );
  const resourcesById = new Map(scenario.stack.resources.map((r) => [r.id, r]));
  const tuples: TupleWrite[] = [];
  for (const g of scenario.stack.grants) {
    if (g.revokedAt) continue; // a grant seeded already-revoked has no live RBA tuple to derive
    const principal = principalsById.get(g.principalId);
    const resource = resourcesById.get(g.resourceId);
    if (!principal || !resource)
      throw new Error(
        `scenario ${scenario.id}: grant references unknown principal/resource id`,
      );
    const subject = rbaSubject(scenario, principal);
    const object = rbaObject(scenario, resource);
    tuples.push({
      objectNs: object.ns,
      objectId: object.id,
      relation: g.relation,
      subjectNs: subject.ns,
      subjectId: subject.id,
    });
  }
  return tuples;
}

/** Every extra, hand-authored tuple (schema.tuples[]) gets the identical scenario-id
 * scoping applied to its object/subject ids as every derived tuple and every
 * Postgres-seeded principal/resource — one RBA instance shared by a whole CI run can't
 * have two scenarios' group-nesting fixtures collide on the same namespace:id pair. A
 * userset subject's own id (subjectRelation set) is scoped the same way its underlying
 * object would be, since it names another (objectNs, objectId) pair by construction. */
export function scopeExplicitTuples(
  scenario: Scenario,
  tuples: TupleWrite[],
): TupleWrite[] {
  // '*' is RBA's own reserved wildcard subject sentinel (D-171) — scoping it would turn a
  // real wildcard grant into an ordinary, useless literal subject id named "<scenario>::*".
  return tuples.map((t) => ({
    ...t,
    objectId: scoped(scenario, t.objectId),
    subjectId:
      t.subjectId === "*" ? t.subjectId : scoped(scenario, t.subjectId),
  }));
}
