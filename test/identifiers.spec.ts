import { describe, it, expect } from "vitest";
import {
  scoped,
  rbaSubject,
  rbaObject,
  rbaIdentifier,
} from "../src/scenario/identifiers.js";
import {
  grantsToRebacTuples,
  scopeExplicitTuples,
} from "../src/scenario/seed.js";
import { scenarioSchema, type Scenario } from "../src/types/scenario.js";

function scenario(overrides: Record<string, unknown> = {}): Scenario {
  return scenarioSchema.parse({
    id: "ident-test",
    title: "x",
    summary: "x".repeat(20),
    taxonomy: [{ source: "identity", id: "stale-grant-abuse" }],
    stack: {
      principals: [
        { id: "alice", kind: "human", externalId: "alice", source: "manual" },
      ],
      resources: [
        { id: "doc1", kind: "document", externalId: "doc1", source: "manual" },
      ],
      grants: [
        {
          principalId: "alice",
          resourceId: "doc1",
          relation: "viewer",
          source: "manual",
        },
      ],
      rebac: {
        tuples: [
          {
            objectNs: "group",
            objectId: "g1",
            relation: "member",
            subjectNs: "user",
            subjectId: "*",
          },
        ],
      },
      adcTokens: [],
    },
    tools: [],
    adversary: { actingPrincipalId: "alice", steps: [] },
    expected: {
      cells: [{ layer: "rebac", outcome: "missed", rationale: "x".repeat(20) }],
    },
    ...overrides,
  });
}

describe("scoped()", () => {
  it("namespaces an externalId by scenario id", () => {
    expect(scoped(scenario(), "alice")).toBe("ident-test::alice");
  });

  it("produces different keys for different scenarios sharing the same externalId", () => {
    const a = scenario({ id: "scenario-a" });
    const b = scenario({ id: "scenario-b" });
    expect(scoped(a, "alice")).not.toBe(scoped(b, "alice"));
  });
});

describe("rbaIdentifier", () => {
  it("collapses every character outside RBA's own IDENTIFIER_PATTERN (a-z0-9_) to '_'", () => {
    expect(rbaIdentifier("manual:stale-grant-abuse::prod-config")).toBe(
      "manual_stale_grant_abuse__prod_config",
    );
  });

  it("prefixes a result that wouldn't start with a lowercase letter", () => {
    expect(rbaIdentifier("123-abc")).toBe("id_123_abc");
  });

  it("is idempotent on an already-legal identifier", () => {
    expect(rbaIdentifier("already_legal_123")).toBe("already_legal_123");
  });

  it("hashes down (rather than truncates) an identifier over RBA's 63-char cap, so two long ids sharing a prefix can't collide", () => {
    const a = rbaIdentifier(`manual:${"x".repeat(80)}::a-long-tail-one`);
    const b = rbaIdentifier(`manual:${"x".repeat(80)}::a-long-tail-two`);
    expect(a.length).toBeLessThanOrEqual(63);
    expect(b.length).toBeLessThanOrEqual(63);
    expect(a).not.toBe(b);
  });
});

describe("rbaSubject/rbaObject", () => {
  it("matches Principal-Graph's own RBA-exporter convention up to rbaIdentifier()'s sanitization: principal ns, `${source}:${scopedExternalId}` id with every RBA-illegal character collapsed to '_'", () => {
    const s = scenario();
    const subject = rbaSubject(s, { source: "manual", externalId: "alice" });
    // Raw would be "manual:ident-test::alice" (Principal-Graph's own identityRef()
    // convention) — every ':'/'-' RBA's own IDENTIFIER_PATTERN rejects becomes '_'. See
    // taxonomy/gaps/principal-graph.yaml's rba-exporter-identifier-grammar-mismatch row.
    expect(subject).toEqual({
      ns: "principal",
      id: "manual_ident_test__alice",
    });
  });

  it("uses resource.kind as objectNs", () => {
    const s = scenario();
    const object = rbaObject(s, {
      kind: "document",
      source: "manual",
      externalId: "doc1",
    });
    expect(object).toEqual({
      ns: "document",
      id: "manual_ident_test__doc1",
    });
  });
});

describe("grantsToRebacTuples", () => {
  it("derives one tuple per live grant, skipping already-revoked ones", () => {
    const s = scenario();
    const tuples = grantsToRebacTuples(s);
    expect(tuples).toEqual([
      {
        objectNs: "document",
        objectId: "manual_ident_test__doc1",
        relation: "viewer",
        subjectNs: "principal",
        subjectId: "manual_ident_test__alice",
      },
    ]);
  });

  it("skips a grant seeded with revokedAt set", () => {
    const s = scenario({
      stack: {
        principals: [
          { id: "alice", kind: "human", externalId: "alice", source: "manual" },
        ],
        resources: [
          {
            id: "doc1",
            kind: "document",
            externalId: "doc1",
            source: "manual",
          },
        ],
        grants: [
          {
            principalId: "alice",
            resourceId: "doc1",
            relation: "viewer",
            source: "manual",
            revokedAt: "2020-01-01T00:00:00.000Z",
          },
        ],
        rebac: { tuples: [] },
        adcTokens: [],
      },
    });
    expect(grantsToRebacTuples(s)).toEqual([]);
  });
});

describe("scopeExplicitTuples", () => {
  it('scopes and sanitizes both object and subject ids, but leaves the "*" wildcard sentinel untouched', () => {
    const s = scenario();
    const scopedTuples = scopeExplicitTuples(s, s.stack.rebac.tuples);
    expect(scopedTuples).toEqual([
      {
        objectNs: "group",
        objectId: "ident_test__g1",
        relation: "member",
        subjectNs: "user",
        subjectId: "*",
      },
    ]);
  });
});
