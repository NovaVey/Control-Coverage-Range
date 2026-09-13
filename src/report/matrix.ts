import type { Scenario } from "../types/scenario.js";
import type { Layer, Outcome } from "../types/layers.js";
import { OUTCOME_SEVERITY } from "../types/layers.js";
import { taxonomyKey, type TaxonomyRef } from "../types/taxonomy.js";
import type { CellValidation } from "../scoring/score.js";
import { isExpectedGap } from "../scoring/score.js";

export interface MatrixCell {
  outcome: Outcome;
  /** Every scenario that produced this cell (usually one; more than one if two scenarios
   * both claim a cell for the same taxonomy row x layer pair — see mergeCells below for
   * how a conflict is resolved and surfaced). */
  scenarios: Array<{
    scenarioId: string;
    outcome: Outcome;
    rationale: string;
    valid: boolean;
    problem?: string;
    assertsKnownGap: boolean;
  }>;
}

export interface CoverageMatrix {
  /** taxonomyKey(ref) -> layer -> cell. A row with no scenario touching a given layer at
   * all has no entry there — see report/render-markdown.ts for how an absent cell (never
   * claimed by anything) is rendered distinctly from an explicit `missed`. */
  cells: Map<string, Partial<Record<Layer, MatrixCell>>>;
  /** Every taxonomy row referenced by at least one scenario, in encounter order — used to
   * render rows in a stable order. The cross-check against requiresScenario rows lives
   * entirely in src/taxonomy/gaps-coverage.ts's checkGapsCoverage() (run via
   * `npm run range:gaps-coverage`), not here — this matrix only ever knows about rows
   * something actually referenced, by construction (see buildCoverageMatrix below). */
  rowOrder: string[];
  anyInvalid: boolean;
}

/** The worse outcome wins when more than one scenario claims a cell for the same
 * taxonomy row x layer — a matrix is supposed to report the LEAST favorable known
 * result, not average away a real miss with an unrelated pass. */
function worse(a: Outcome, b: Outcome): Outcome {
  return OUTCOME_SEVERITY[a] >= OUTCOME_SEVERITY[b] ? a : b;
}

export function buildCoverageMatrix(
  scenarioValidations: Array<{ scenario: Scenario; cells: CellValidation[] }>,
): CoverageMatrix {
  const cells = new Map<string, Partial<Record<Layer, MatrixCell>>>();
  const rowOrder: string[] = [];
  let anyInvalid = false;

  for (const { scenario, cells: cellValidations } of scenarioValidations) {
    for (const ref of scenario.taxonomy as TaxonomyRef[]) {
      const key = taxonomyKey(ref);
      if (!cells.has(key)) {
        cells.set(key, {});
        rowOrder.push(key);
      }
      const row = cells.get(key)!;
      for (const cv of cellValidations) {
        if (!cv.valid) anyInvalid = true;
        const entry = {
          scenarioId: scenario.id,
          outcome: cv.claimed,
          rationale: cv.rationale,
          valid: cv.valid,
          problem: cv.problem,
          assertsKnownGap: isExpectedGap(scenario, cv),
        };
        const existing = row[cv.layer];
        if (!existing) {
          row[cv.layer] = { outcome: cv.claimed, scenarios: [entry] };
        } else {
          existing.scenarios.push(entry);
          existing.outcome = worse(existing.outcome, cv.claimed);
        }
      }
    }
  }

  return { cells, rowOrder, anyInvalid };
}
