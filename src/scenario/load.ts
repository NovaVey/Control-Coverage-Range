import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { scenarioSchema, type Scenario } from "../types/scenario.js";
import { taxonomyKey } from "../types/taxonomy.js";
import type { LoadedTaxonomy } from "../taxonomy/load.js";

export function loadScenarioFile(path: string): Scenario {
  const raw = parseYaml(readFileSync(path, "utf8"));
  const result = scenarioSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${path}: invalid scenario — ${result.error.message}`);
  }
  return result.data;
}

export function listScenarioFiles(scenariosDir: string): string[] {
  const out: string[] = [];
  // Same reproducibility concern as taxonomy/load.ts's listYamlFiles: readdirSync's order
  // is filesystem-dependent, not alphabetical, and this order flows straight into
  // buildCoverageMatrix's multi-scenario cell merge — sort at every level so it doesn't.
  const entries = readdirSync(scenariosDir, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const full = join(scenariosDir, entry.name);
    if (entry.isDirectory()) out.push(...listScenarioFiles(full));
    else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
      out.push(full);
  }
  return out;
}

export function loadAllScenarios(scenariosDir: string): Scenario[] {
  const scenarios = listScenarioFiles(scenariosDir).map(loadScenarioFile);
  const seen = new Set<string>();
  for (const s of scenarios) {
    if (seen.has(s.id)) throw new Error(`duplicate scenario id: ${s.id}`);
    seen.add(s.id);
  }
  return scenarios;
}

/** Cross-checks every scenario's taxonomy[] references against the loaded taxonomy —
 * a scenario that names a row that doesn't exist is a scenario-authoring bug, not a
 * silently-ignored reference. */
export function validateTaxonomyRefs(
  scenarios: Scenario[],
  taxonomy: LoadedTaxonomy,
): string[] {
  const problems: string[] = [];
  for (const s of scenarios) {
    for (const ref of s.taxonomy) {
      if (!taxonomy.rows.has(taxonomyKey(ref))) {
        problems.push(
          `${s.id}: references unknown taxonomy row ${taxonomyKey(ref)}`,
        );
      }
    }
  }
  return problems;
}
