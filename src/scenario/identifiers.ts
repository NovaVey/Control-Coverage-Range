import { createHash } from "node:crypto";
import type { Scenario } from "../types/scenario.js";

/** Same scenario-id namespacing src/adapters/principal-graph.ts applies to Postgres
 * identity rows, applied consistently to RBA subject/object ids and ADC mint subjects —
 * one shared RBA instance and one shared Postgres instance can host every scenario in a
 * CI run without any of them colliding on the same identifier. */
export function scoped(scenario: Scenario, externalId: string): string {
  return `${scenario.id}::${externalId}`;
}

/** relationship-based-authorization/src/schema/dsl/types.ts's own IDENTIFIER_PATTERN
 * (/^[a-z][a-z0-9_]*$/) and MAX_IDENTIFIER_LENGTH (63) — copied here as plain literals
 * since RBA is consumed purely over HTTP (ARCHITECTURE.md), not imported in-process. */
const RBA_MAX_ID_LENGTH = 63;

/**
 * Sanitizes an opaque identifier so it satisfies RBA's own real, load-bearing grammar for
 * `objectId`/`subjectId` (relationship-based-authorization/src/store/tuples.ts's
 * `validateIdentifiers`, reusing schema/dsl/types.ts's `IDENTIFIER_PATTERN`/
 * `MAX_IDENTIFIER_LENGTH` — "the same grammar the schema DSL compiler enforces on
 * namespace/relation names"). That grammar is far stricter than an opaque external id
 * needs to be — lowercase ASCII/digits/underscore only, starting with a letter, ≤63
 * chars — which every `:`-joined and `-`-kebab-cased id this range (and, confirmed,
 * Principal-Graph's own real `identityRef()` exporter) naturally produces violates. See
 * taxonomy/gaps/principal-graph.yaml's rba-exporter-identifier-grammar-mismatch row: this
 * range's own tuple ids are therefore never byte-for-byte identical to what that real
 * exporter would send (nothing could be — that exporter's own output can never satisfy
 * this grammar, so there is no real, working convention left to copy verbatim), only
 * equivalent up to this sanitization.
 *
 * Every disallowed character collapses to `_`; a result not starting with a lowercase
 * letter gets an `id_` prefix (never true for this range's own inputs, which always start
 * with a scenario id, but kept correct for a hand-authored external id that might not).
 * A result over the length cap is hashed down rather than truncated — truncation risks
 * two distinct long ids that share a prefix (e.g. two scenario ids differing only near
 * the end) colliding on the same shortened value; a content hash suffix does not.
 */
export function rbaIdentifier(raw: string): string {
  const collapsed = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const safe = /^[a-z]/.test(collapsed) ? collapsed : `id_${collapsed}`;
  if (safe.length <= RBA_MAX_ID_LENGTH) return safe;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `${safe.slice(0, RBA_MAX_ID_LENGTH - hash.length - 1)}_${hash}`;
}

/** Matches Principal-Graph's own RBA-exporter convention (src/exporters/rba.ts: subjectNs
 * is the fixed constant 'principal', subjectId is `${source}:${externalId}`) up to
 * rbaIdentifier()'s sanitization — see that function's own doc comment for why an exact
 * byte-for-byte match is impossible here. */
export function rbaSubject(
  scenario: Scenario,
  principal: { source: string; externalId: string },
): { ns: string; id: string } {
  return {
    ns: "principal",
    id: rbaIdentifier(
      `${principal.source}:${scoped(scenario, principal.externalId)}`,
    ),
  };
}

/** Matches Principal-Graph's own RBA-exporter convention: objectNs = resource.kind,
 * objectId = `${source}:${externalId}`, up to rbaIdentifier()'s sanitization. */
export function rbaObject(
  scenario: Scenario,
  resource: { kind: string; source: string; externalId: string },
): { ns: string; id: string } {
  return {
    ns: resource.kind,
    id: rbaIdentifier(
      `${resource.source}:${scoped(scenario, resource.externalId)}`,
    ),
  };
}
