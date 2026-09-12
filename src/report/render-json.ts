import type { CoverageMatrix } from "./matrix.js";
import { LAYERS } from "../types/layers.js";
import type { LoadedTaxonomy } from "../taxonomy/load.js";

/** A stable, diffable JSON snapshot — this is what src/report/baseline.ts compares run to
 * run for the CI regression gate, and what a machine-readable consumer (a dashboard, a
 * PR comment bot) should read rather than parsing the markdown table. */
export interface MatrixSnapshot {
  generatedAt: string;
  rows: Record<
    string,
    {
      name: string;
      cells: Partial<
        Record<
          (typeof LAYERS)[number],
          {
            outcome: string;
            scenarioIds: string[];
            anyInvalid: boolean;
            anyAssertsKnownGap: boolean;
          }
        >
      >;
    }
  >;
}

export function renderJsonSnapshot(
  matrix: CoverageMatrix,
  taxonomy: LoadedTaxonomy,
  now: () => string,
): MatrixSnapshot {
  const rows: MatrixSnapshot["rows"] = {};
  for (const key of matrix.rowOrder) {
    const row = matrix.cells.get(key)!;
    const cells: MatrixSnapshot["rows"][string]["cells"] = {};
    for (const layer of LAYERS) {
      const cell = row[layer];
      if (!cell) continue;
      cells[layer] = {
        outcome: cell.outcome,
        scenarioIds: cell.scenarios.map((s) => s.scenarioId),
        anyInvalid: cell.scenarios.some((s) => !s.valid),
        anyAssertsKnownGap: cell.scenarios.some((s) => s.assertsKnownGap),
      };
    }
    rows[key] = { name: taxonomy.rows.get(key)?.name ?? key, cells };
  }
  return { generatedAt: now(), rows };
}
