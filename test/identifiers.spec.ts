import { describe, it, expect } from "vitest";
import { scoped, rbaSubject, rbaObject } from "../src/scenario/identifiers.js";
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

describe("rbaSubject/rbaObject", () => {
  it("matches Principal-Graph's own RBA-exporter convention: principal ns, `${source}:${scopedExternalId}` id", () => {
    const s = scenario();
    const subject = rbaSubject(s, { source: "manual", externalId: "alice" });
    expect(subject).toEqual({
      ns: "principal",
      id: "manual:ident-test::alice",
    });
  });

  it("uses resource.kind as objectNs", () => {
    const s = scenario();
    const object = rbaObject(s, {
      kind: "document",
      source: "manual",
      externalId: "doc1",
    });
    expect(object).toEqual({ ns: "document", id: "manual:ident-test::doc1" });
  });
});

describe("grantsToRebacTuples", () => {
  it("derives one tuple per live grant, skipping already-revoked ones", () => {
    const s = scenario();
    const tuples = grantsToRebacTuples(s);
    expect(tuples).toEqual([
      {
        objectNs: "document",
        objectId: "manual:ident-test::doc1",
        relation: "viewer",
        subjectNs: "principal",
        subjectId: "manual:ident-test::alice",
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
  it('scopes both object and subject ids, but leaves the "*" wildcard sentinel untouched', () => {
    const s = scenario();
    const scopedTuples = scopeExplicitTuples(s, s.stack.rebac.tuples);
    expect(scopedTuples).toEqual([
      {
        objectNs: "group",
        objectId: "ident-test::g1",
        relation: "member",
        subjectNs: "user",
        subjectId: "*",
      },
    ]);
  });
});
