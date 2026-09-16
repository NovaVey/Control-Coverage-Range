import type { Scenario } from "../types/scenario.js";
import type { TupleWrite } from "../adapters/rba.js";
import { scoped, rbaObject, rbaSubject } from "./identifiers.js";

/** Mirrors Principal-Graph's own real RBA-exporter mapping (src/exporters/rba.ts,
 * confirmed directly against that file), byte-for-byte: objectNs = resource.kind,
 * objectId = `${resource.source}:${externalId}`, relation unchanged, subjectNs = the
 * fixed constant 'principal', subjectId = `${principal.source}:${externalId}` — see
 * rbaSubject()/rbaObject()'s own doc comments (src/scenario/identifiers.ts) for why this
 * no longer needs any sanitization to satisfy RBA's own real identifier grammar. */
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
 * have two scenarios' group-nesting fixtures collide on the same namespace:id pair.
 *
 * A tuple's own objectId/subjectId can name one of TWO different things, and each needs a
 * different resolution:
 *   - A purely synthetic RBA-only fixture never declared in stack.principals/resources
 *     (a group-nesting scenario's own "leaf"/"mid"/"root" group ids, say) — scoped
 *     directly, same as always.
 *   - A real stack.principals[]/resources[] entry ALSO independently looked up elsewhere
 *     (expected.rebac.check's rbaSubject()/rbaObject(), grantsToRebacTuples(),
 *     resolveScopeCaveats()) — which must resolve through that SAME function, not just
 *     scoped directly, or the two paths produce different ids for the identical logical
 *     principal/resource and never connect. Confirmed empirically: an explicit
 *     tuple naming alice via `subjectNs: user` while expected.rebac.check's own lookup
 *     resolves her via rbaSubject() (always `ns: 'principal'`, source-prefixed) never
 *     matched at all — RBA correctly reported no connection, which happened to still equal
 *     a scenario's own expected `allowed: false` in one case (isolation held for the wrong,
 *     vacuous reason) and openly contradicted it in another (a real, legitimate group chain
 *     scored as denied). A tuple naming a declared principal/resource therefore has its own
 *     subjectNs/objectNs OVERRIDDEN to whatever rbaSubject()/rbaObject() actually returns
 *     (respecting that principal's real kind/source, that resource's real kind), not
 *     whatever the YAML happened to write — every scenario using this path also declares
 *     that override subject type in its own schema (e.g. `principal` alongside `user`), or
 *     RBA's own subject_type_not_allowed check rejects the write.
 *
 * '*' is RBA's own reserved wildcard subject sentinel (D-171) — resolving or scoping it
 * would turn a real wildcard grant into an ordinary, useless literal subject id. */
export function scopeExplicitTuples(
  scenario: Scenario,
  tuples: TupleWrite[],
): TupleWrite[] {
  const principalsById = new Map(
    scenario.stack.principals.map((p) => [p.id, p]),
  );
  const resourcesById = new Map(scenario.stack.resources.map((r) => [r.id, r]));

  return tuples.map((t) => {
    const resource = resourcesById.get(t.objectId);
    const object = resource
      ? rbaObject(scenario, resource)
      : { ns: t.objectNs, id: scoped(scenario, t.objectId) };

    let subject: { ns: string; id: string };
    if (t.subjectId === "*") {
      subject = { ns: t.subjectNs, id: t.subjectId };
    } else {
      const principal = principalsById.get(t.subjectId);
      subject = principal
        ? rbaSubject(scenario, principal)
        : { ns: t.subjectNs, id: scoped(scenario, t.subjectId) };
    }

    return {
      ...t,
      objectNs: object.ns,
      objectId: object.id,
      subjectNs: subject.ns,
      subjectId: subject.id,
    };
  });
}
