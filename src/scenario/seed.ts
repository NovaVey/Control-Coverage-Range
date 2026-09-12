import type { Scenario } from "../types/scenario.js";
import type { TupleWrite } from "../adapters/rba.js";
import { scoped, rbaObject, rbaSubject, rbaIdentifier } from "./identifiers.js";

/** Mirrors Principal-Graph's own real RBA-exporter mapping (src/exporters/rba.ts,
 * confirmed directly against that file): objectNs = resource.kind, objectId =
 * `${resource.source}:${externalId}`, relation unchanged, subjectNs = the fixed constant
 * 'principal', subjectId = `${principal.source}:${externalId}` — up to rbaIdentifier()'s
 * own sanitization (src/scenario/identifiers.ts), which is as close to that real exporter's
 * output as a tuple can get and still be accepted by RBA's own real identifier grammar; see
 * that function's own doc comment, and taxonomy/gaps/principal-graph.yaml's
 * rba-exporter-identifier-grammar-mismatch row, for why an exact byte-for-byte copy is not
 * possible here. */
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
 * object would be, since it names another (objectNs, objectId) pair by construction.
 * Also run through rbaIdentifier() — see identifiers.ts's own doc comment — since a
 * hand-authored externalId is just as likely to contain a `-` or other character RBA's
 * own IDENTIFIER_PATTERN rejects as a derived one is. */
export function scopeExplicitTuples(
  scenario: Scenario,
  tuples: TupleWrite[],
): TupleWrite[] {
  // '*' is RBA's own reserved wildcard subject sentinel (D-171) — scoping it would turn a
  // real wildcard grant into an ordinary, useless literal subject id named "<scenario>::*".
  return tuples.map((t) => ({
    ...t,
    objectId: rbaIdentifier(scoped(scenario, t.objectId)),
    subjectId:
      t.subjectId === "*"
        ? t.subjectId
        : rbaIdentifier(scoped(scenario, t.subjectId)),
  }));
}
