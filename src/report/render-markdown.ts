import type { CoverageMatrix } from "./matrix.js";
import {
  LAYERS,
  LAYER_LABELS,
  OUTCOME_LABELS,
  type Outcome,
} from "../types/layers.js";
import type { LoadedTaxonomy } from "../taxonomy/load.js";

const OUTCOME_ICON: Record<Outcome, string> = {
  blocked: "🟢",
  approval: "🟡",
  "observed-only": "🔵",
  "blocked-incidentally": "🟠",
  missed: "🔴",
};

function cellText(
  matrix: CoverageMatrix,
  key: string,
  layer: (typeof LAYERS)[number],
): string {
  const cell = matrix.cells.get(key)?.[layer];
  if (!cell) return "—";
  const invalidMark = cell.scenarios.some((s) => !s.valid) ? " ⚠️" : "";
  const gapMark = cell.scenarios.some((s) => s.assertsKnownGap)
    ? " *(known gap)*"
    : "";
  return `${OUTCOME_ICON[cell.outcome]} ${OUTCOME_LABELS[cell.outcome]}${gapMark}${invalidMark}`;
}

export function renderMarkdown(
  matrix: CoverageMatrix,
  taxonomy: LoadedTaxonomy,
): string {
  const lines: string[] = [];
  lines.push("# Control-Coverage-Range — coverage matrix");
  lines.push("");
  lines.push(
    "Legend: 🟢 Blocked · 🟡 Approval · 🔵 Observed-only · 🟠 Blocked-incidentally · 🔴 Missed · ⚠️ a scenario's claimed outcome did not hold up empirically (see its own detail below) · — no scenario in this corpus makes a claim about this cell yet.",
  );
  lines.push("");
  lines.push(
    "`rebac` and `identity-graph` never gate a call in this range's own architecture — they can only ever be Observed-only or Missed. `broker` and `adc` are the two columns that can actually be Blocked/Approval/Blocked-incidentally. See ARCHITECTURE.md.",
  );
  lines.push("");
  lines.push(
    `| Technique (taxonomy row) | ${LAYERS.map((l) => LAYER_LABELS[l]).join(" | ")} |`,
  );
  lines.push(`|---|${LAYERS.map(() => "---").join("|")}|`);

  for (const key of matrix.rowOrder) {
    const row = taxonomy.rows.get(key);
    const name = row ? row.name : key;
    lines.push(
      `| ${name} | ${LAYERS.map((l) => cellText(matrix, key, l)).join(" | ")} |`,
    );
  }
  lines.push("");

  const invalidScenarios = new Set<string>();
  for (const row of matrix.cells.values()) {
    for (const layer of LAYERS) {
      for (const s of row[layer]?.scenarios ?? []) {
        if (!s.valid)
          invalidScenarios.add(`${s.scenarioId} (${layer}): ${s.problem}`);
      }
    }
  }
  if (invalidScenarios.size > 0) {
    lines.push("## ⚠️ Claims that did not hold up empirically");
    lines.push("");
    lines.push(
      "A scenario's own expected.cells[].outcome is a claim, argued via its own rationale — not something this report trusts blindly. Each line below is a claim the real, assembled stack contradicted on this run:",
    );
    lines.push("");
    for (const line of invalidScenarios) lines.push(`- ${line}`);
    lines.push("");
  }

  return lines.join("\n");
}
