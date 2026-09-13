import { fileURLToPath } from "node:url";
import { loadTaxonomy, requiresScenarioRows } from "./load.js";
import { loadAllScenarios } from "../scenario/load.js";
import { taxonomyKey } from "../types/taxonomy.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The mechanism GAPS.md #3 (taxonomy/gaps/control-coverage-range.yaml,
 * scenario-authorship-bias) describes: every taxonomy row marked requiresScenario:true
 * (the default for every gaps/* and identity row) must be referenced by at least one
 * scenario's own taxonomy[] list, or this check fails. This is what stops "we published
 * the gap in a YAML file" from quietly substituting for "we actually built a scenario
 * that demonstrates it." A row that opts out with requiresScenario:false skips this check
 * entirely — see src/types/taxonomy.ts's exemptionRationale for that opt-out's own,
 * separately-enforced audit trail.
 */
export function checkGapsCoverage(
  scenariosDir: string = `${REPO_ROOT}scenarios`,
): string[] {
  const taxonomy = loadTaxonomy();
  const scenarios = loadAllScenarios(scenariosDir);
  const referenced = new Set<string>();
  for (const s of scenarios) {
    for (const ref of s.taxonomy) referenced.add(taxonomyKey(ref));
  }

  const problems: string[] = [];
  for (const row of requiresScenarioRows(taxonomy)) {
    const key = taxonomyKey({ source: row.source, id: row.id });
    if (!referenced.has(key)) {
      problems.push(
        `taxonomy row ${key} ("${row.name}") requires a scenario but no scenario references it`,
      );
    }
  }
  return problems;
}
