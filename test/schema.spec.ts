import { describe, it, expect } from "vitest";
import {
  loadAllScenarios,
  validateTaxonomyRefs,
} from "../src/scenario/load.js";
import { loadTaxonomy } from "../src/taxonomy/load.js";

const SCENARIOS_DIR = new URL("../scenarios/", import.meta.url).pathname;

describe("scenario corpus", () => {
  const scenarios = loadAllScenarios(SCENARIOS_DIR);

  it("has at least one scenario", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it("every scenario id is unique (enforced again here, not just trusted from the loader)", () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every taxonomy reference resolves against the loaded taxonomy", () => {
    const taxonomy = loadTaxonomy();
    const problems = validateTaxonomyRefs(scenarios, taxonomy);
    expect(problems).toEqual([]);
  });

  it("a broker/adc cell claiming blocked or blocked-incidentally declares a reasonMatches pattern for that layer", () => {
    // Mirrors src/types/scenario.ts's own documented lint rule: a bare "it was blocked"
    // claim with nothing to check the REASON against is exactly the self-deception this
    // project exists to catch — see src/scoring/score.ts's own blocked-incidentally logic,
    // which can only distinguish the two when a pattern is actually supplied.
    const problems: string[] = [];
    for (const s of scenarios) {
      for (const cell of s.expected.cells) {
        if (cell.layer !== "broker" && cell.layer !== "adc") continue;
        if (
          cell.outcome !== "blocked" &&
          cell.outcome !== "blocked-incidentally"
        )
          continue;
        const pattern =
          cell.layer === "broker"
            ? s.expected.broker?.reasonMatches
            : s.expected.adc?.reasonMatches;
        if (!pattern) {
          problems.push(
            `${s.id}: [${cell.layer}] claims '${cell.outcome}' with no reasonMatches pattern declared`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("every rationale is non-trivial prose, not a placeholder", () => {
    const problems: string[] = [];
    for (const s of scenarios) {
      for (const cell of s.expected.cells) {
        if (cell.rationale.trim().length < 20) {
          problems.push(
            `${s.id}: [${cell.layer}] rationale is suspiciously short: "${cell.rationale}"`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("every scenario referencing an adcToken in a step actually declares that token", () => {
    const problems: string[] = [];
    for (const s of scenarios) {
      const tokenIds = new Set(s.stack.adcTokens.map((t) => t.id));
      for (const step of s.adversary.steps) {
        if (step.adcToken && !tokenIds.has(step.adcToken)) {
          problems.push(
            `${s.id}: step references undeclared adcToken "${step.adcToken}"`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("every scenario tool referenced by an adversary step is declared", () => {
    const problems: string[] = [];
    for (const s of scenarios) {
      const toolNames = new Set(s.tools.map((t) => t.name));
      for (const step of s.adversary.steps) {
        if (!toolNames.has(step.tool)) {
          problems.push(
            `${s.id}: step references undeclared tool "${step.tool}"`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
