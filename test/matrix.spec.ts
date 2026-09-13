import { describe, it, expect } from "vitest";
import { scenarioSchema, type Scenario } from "../src/types/scenario.js";
import { buildCoverageMatrix } from "../src/report/matrix.js";
import type { CellValidation } from "../src/scoring/score.js";

function minimalScenario(
  overrides: Partial<Parameters<typeof scenarioSchema.parse>[0]> = {},
): Scenario {
  return scenarioSchema.parse({
    id: "test-scenario",
    title: "Test",
    summary:
      "A synthetic scenario used only to exercise buildCoverageMatrix in isolation.",
    taxonomy: [{ source: "owasp-llm", id: "LLM01" }],
    stack: {
      principals: [{ id: "p1", kind: "agent", externalId: "p1" }],
      resources: [],
      grants: [],
      rebac: { tuples: [] },
      adcTokens: [],
    },
    tools: [{ name: "shell_exec", capabilities: ["exec:shell"] }],
    adversary: {
      actingPrincipalId: "p1",
      steps: [{ tool: "shell_exec", args: {} }],
    },
    expected: {
      cells: [
        {
          layer: "broker",
          outcome: "blocked",
          rationale: "because the taint gate correctly denied it",
        },
      ],
    },
    ...overrides,
  });
}

function cell(overrides: Partial<CellValidation> = {}): CellValidation {
  return {
    layer: "broker",
    claimed: "blocked",
    rationale: "test rationale",
    valid: true,
    ...overrides,
  };
}

describe("buildCoverageMatrix", () => {
  it("builds rowOrder from taxonomy references, one entry per row, in encounter order", () => {
    const s1 = minimalScenario({
      id: "s1",
      taxonomy: [
        { source: "owasp-llm", id: "LLM01" },
        { source: "owasp-llm", id: "LLM02" },
      ],
    });
    const s2 = minimalScenario({
      id: "s2",
      taxonomy: [{ source: "owasp-llm", id: "LLM02" }],
    });

    const matrix = buildCoverageMatrix([
      { scenario: s1, cells: [cell()] },
      { scenario: s2, cells: [cell()] },
    ]);

    expect(matrix.rowOrder).toEqual(["owasp-llm#LLM01", "owasp-llm#LLM02"]);
  });

  it("a row with no scenario referencing it never appears in rowOrder or cells", () => {
    const s1 = minimalScenario({
      taxonomy: [{ source: "owasp-llm", id: "LLM01" }],
    });
    const matrix = buildCoverageMatrix([{ scenario: s1, cells: [cell()] }]);
    expect(matrix.rowOrder).not.toContain("owasp-llm#LLM09");
    expect(matrix.cells.has("owasp-llm#LLM09")).toBe(false);
  });

  it("a layer no scenario claims for a row has no cell entry at all (absent, not a claim of missed)", () => {
    const s1 = minimalScenario();
    const matrix = buildCoverageMatrix([
      { scenario: s1, cells: [cell({ layer: "broker", claimed: "blocked" })] },
    ]);
    const row = matrix.cells.get("owasp-llm#LLM01")!;
    expect(row.broker).toBeDefined();
    expect(row.adc).toBeUndefined();
    expect(row.rebac).toBeUndefined();
    expect(row["identity-graph"]).toBeUndefined();
  });

  it("merges two scenarios' claims for the same row x layer, picking the strictly worse outcome", () => {
    const s1 = minimalScenario({ id: "s1" });
    const s2 = minimalScenario({ id: "s2" });

    const matrix = buildCoverageMatrix([
      { scenario: s1, cells: [cell({ claimed: "blocked" })] },
      { scenario: s2, cells: [cell({ claimed: "missed" })] },
    ]);

    const row = matrix.cells.get("owasp-llm#LLM01")!;
    expect(row.broker!.outcome).toBe("missed");
    // Both scenarios' own individual claims survive in scenarios[], even though the
    // merged cell-level outcome picks only the worse one — a reader following the matrix
    // back to its evidence needs the blocked claim still visible, not silently dropped.
    expect(row.broker!.scenarios.map((sc) => sc.scenarioId).sort()).toEqual([
      "s1",
      "s2",
    ]);
    expect(
      row.broker!.scenarios.find((sc) => sc.scenarioId === "s1")!.outcome,
    ).toBe("blocked");
  });

  it("merge order doesn't matter — a worse claim arriving first still wins", () => {
    const s1 = minimalScenario({ id: "s1" });
    const s2 = minimalScenario({ id: "s2" });

    const matrix = buildCoverageMatrix([
      { scenario: s1, cells: [cell({ claimed: "missed" })] },
      { scenario: s2, cells: [cell({ claimed: "blocked" })] },
    ]);

    expect(matrix.cells.get("owasp-llm#LLM01")!.broker!.outcome).toBe("missed");
  });

  it("an equally-severe second claim keeps the existing outcome (worse() ties go to `a`)", () => {
    const s1 = minimalScenario({ id: "s1" });
    const s2 = minimalScenario({ id: "s2" });

    const matrix = buildCoverageMatrix([
      { scenario: s1, cells: [cell({ claimed: "approval" })] },
      { scenario: s2, cells: [cell({ claimed: "approval" })] },
    ]);

    expect(matrix.cells.get("owasp-llm#LLM01")!.broker!.outcome).toBe(
      "approval",
    );
  });

  it("blocked-incidentally outranks observed-only in severity (worse of the two)", () => {
    const s1 = minimalScenario({ id: "s1" });
    const s2 = minimalScenario({ id: "s2" });

    const matrix = buildCoverageMatrix([
      { scenario: s1, cells: [cell({ claimed: "observed-only" })] },
      { scenario: s2, cells: [cell({ claimed: "blocked-incidentally" })] },
    ]);

    expect(matrix.cells.get("owasp-llm#LLM01")!.broker!.outcome).toBe(
      "blocked-incidentally",
    );
  });

  it("any invalid cell claim across the whole run sets anyInvalid", () => {
    const s1 = minimalScenario();
    const matrix = buildCoverageMatrix([
      {
        scenario: s1,
        cells: [cell({ valid: false, problem: "did not match empirically" })],
      },
    ]);
    expect(matrix.anyInvalid).toBe(true);
  });

  it("all-valid cells across the whole run leave anyInvalid false", () => {
    const s1 = minimalScenario();
    const matrix = buildCoverageMatrix([
      { scenario: s1, cells: [cell({ valid: true })] },
    ]);
    expect(matrix.anyInvalid).toBe(false);
  });

  it("flags a merged cell's assertsKnownGap per-scenario, not just when every claim agrees", () => {
    const known = minimalScenario({ id: "known-gap", assertsKnownGap: true });
    const unknown = minimalScenario({ id: "not-a-gap" });

    const matrix = buildCoverageMatrix([
      { scenario: known, cells: [cell({ claimed: "missed" })] },
      { scenario: unknown, cells: [cell({ claimed: "missed" })] },
    ]);

    const scenarios = matrix.cells.get("owasp-llm#LLM01")!.broker!.scenarios;
    expect(
      scenarios.find((s) => s.scenarioId === "known-gap")!.assertsKnownGap,
    ).toBe(true);
    expect(
      scenarios.find((s) => s.scenarioId === "not-a-gap")!.assertsKnownGap,
    ).toBe(false);
  });
});
