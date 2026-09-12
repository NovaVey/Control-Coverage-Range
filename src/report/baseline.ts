import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { OUTCOME_SEVERITY, type Outcome } from "../types/layers.js";
import type { MatrixSnapshot } from "./render-json.js";

export interface Regression {
  row: string;
  layer: string;
  from: Outcome;
  to: Outcome;
}

/**
 * A change to any of the four assembled projects that reduces coverage fails CI — this
 * is that check. It never fires for a cell whose current claim is itself flagged
 * `anyAssertsKnownGap` (a scenario that already, deliberately, demonstrates a known,
 * disclosed gap getting worse is not news) and never fires for a cell whose baseline
 * entry was itself `anyInvalid` (a previously-wrong claim regressing further isn't a
 * meaningful signal either — fix the claim first). Every other cell moving to a strictly
 * worse outcome than its last recorded baseline is a hard failure.
 */
export function findRegressions(
  baseline: MatrixSnapshot,
  current: MatrixSnapshot,
): Regression[] {
  const regressions: Regression[] = [];
  for (const [rowKey, baseRow] of Object.entries(baseline.rows)) {
    const curRow = current.rows[rowKey];
    for (const [layer, baseCell] of Object.entries(baseRow.cells)) {
      if (!baseCell || baseCell.anyInvalid) continue;
      const curCell = curRow?.cells[layer as keyof typeof curRow.cells];
      if (!curCell) {
        // The row/layer disappeared entirely — every scenario that used to cover it was
        // deleted or stopped naming this taxonomy row. Treated as a full regression to
        // 'missed', the least favorable outcome, rather than silently dropped from the
        // matrix.
        regressions.push({
          row: rowKey,
          layer,
          from: baseCell.outcome as Outcome,
          to: "missed",
        });
        continue;
      }
      if (curCell.anyAssertsKnownGap) continue;
      const from = baseCell.outcome as Outcome;
      const to = curCell.outcome as Outcome;
      if (OUTCOME_SEVERITY[to] > OUTCOME_SEVERITY[from]) {
        regressions.push({ row: rowKey, layer, from, to });
      }
    }
  }
  return regressions;
}

export function loadBaseline(path: string): MatrixSnapshot | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as MatrixSnapshot;
}

export function saveBaseline(path: string, snapshot: MatrixSnapshot): void {
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}
