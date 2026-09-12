import { describe, it, expect } from "vitest";
import { loadTaxonomy } from "../src/taxonomy/load.js";
import { checkGapsCoverage } from "../src/taxonomy/gaps-coverage.js";

describe("taxonomy", () => {
  it("loads without duplicate row ids across all taxonomy/*.yaml files", () => {
    // loadTaxonomy() itself throws on a duplicate key — a clean load is the assertion.
    const taxonomy = loadTaxonomy();
    expect(taxonomy.rows.size).toBeGreaterThan(0);
  });

  it("every row marked requiresScenario:true (the default) is referenced by at least one scenario", () => {
    // This is GAPS.md #3's own mitigation (scenario-authorship-bias), mechanically
    // enforced rather than left to reviewer attention — see
    // taxonomy/gaps/control-coverage-range.yaml's own row for the reasoning.
    const problems = checkGapsCoverage();
    expect(problems).toEqual([]);
  });

  it("gaps/* sources cite a real reference for every row", () => {
    const taxonomy = loadTaxonomy();
    const problems: string[] = [];
    for (const [key, row] of taxonomy.rows) {
      if (!key.startsWith("gaps/")) continue;
      if (!row.reference || row.reference.trim().length < 10) {
        problems.push(
          `${key}: reference is missing or too short to be a real citation`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
