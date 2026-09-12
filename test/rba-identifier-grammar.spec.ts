import { describe, it, expect } from "vitest";
import { rbaIdentifier } from "../src/scenario/identifiers.js";

/**
 * Proves taxonomy/gaps/principal-graph.yaml's rba-exporter-identifier-grammar-mismatch
 * row mechanically, against RBA's own real, vendored grammar — rather than only in prose.
 *
 * This range is consumed purely over HTTP for RBA (ARCHITECTURE.md), so this test does not
 * import RBA's source in-process; the two constants below are copied verbatim (not
 * re-derived) from relationship-based-authorization/src/schema/dsl/types.ts:51-52 — the
 * same discipline src/scenario/identifiers.ts's own rbaIdentifier() doc comment already
 * applies to the same two constants.
 */
const RBA_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const RBA_MAX_IDENTIFIER_LENGTH = 63;

/** Principal-Graph's own real RBA exporter (src/exporters/rba.ts:129-131) — copied
 * verbatim, not re-derived, for the same reason as the two constants above. */
function identityRefAsPrincipalGraphReallyBuildsIt(
  source: string,
  externalId: string,
): string {
  return `${source}:${externalId}`;
}

describe("Principal-Graph's real RBA exporter vs. RBA's real identifier grammar", () => {
  it("identityRef()'s own colon-joined output always violates RBA's own IDENTIFIER_PATTERN", () => {
    const id = identityRefAsPrincipalGraphReallyBuildsIt("manual", "carol");
    expect(id).toBe("manual:carol");
    expect(RBA_IDENTIFIER_PATTERN.test(id)).toBe(false);
  });

  it("holds for every non-trivial (source, externalId) pair, not just one cherry-picked example", () => {
    const pairs: Array<[string, string]> = [
      ["manual", "carol"],
      ["okta", "alice"],
      ["control-coverage-range", "prod-config"],
      ["github", "some-team"],
    ];
    for (const [source, externalId] of pairs) {
      expect(
        RBA_IDENTIFIER_PATTERN.test(
          identityRefAsPrincipalGraphReallyBuildsIt(source, externalId),
        ),
      ).toBe(false);
    }
  });

  it("this range's own rbaIdentifier() sanitization is what actually satisfies the grammar identityRef() cannot", () => {
    const raw = identityRefAsPrincipalGraphReallyBuildsIt("manual", "carol");
    const sanitized = rbaIdentifier(raw);
    expect(RBA_IDENTIFIER_PATTERN.test(sanitized)).toBe(true);
    expect(sanitized.length).toBeLessThanOrEqual(RBA_MAX_IDENTIFIER_LENGTH);
  });
});
