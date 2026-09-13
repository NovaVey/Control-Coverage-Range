import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import {
  taxonomyFileSchema,
  taxonomyKey,
  type TaxonomyRow,
  type TaxonomySource,
} from "../types/taxonomy.js";

export interface LoadedTaxonomy {
  /** taxonomyKey(ref) -> row, across every taxonomy/*.yaml + taxonomy/gaps/*.yaml file. */
  rows: Map<string, TaxonomyRow & { source: TaxonomySource }>;
  bySource: Map<TaxonomySource, TaxonomyRow[]>;
}

const TAXONOMY_DIR_DEFAULT = fileURLToPath(
  new URL("../../taxonomy/", import.meta.url),
);

function listYamlFiles(dir: string): string[] {
  const out: string[] = [];
  // readdirSync's order is filesystem-dependent, not alphabetical — sorting here (and at
  // each recursion level) is what makes taxonomy row order, and everything downstream of
  // it (the rendered matrix, the persisted baseline), reproducible across machines.
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (entry.isDirectory()) {
      out.push(...listYamlFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

export function loadTaxonomy(
  taxonomyDir: string = TAXONOMY_DIR_DEFAULT,
): LoadedTaxonomy {
  const rows = new Map<string, TaxonomyRow & { source: TaxonomySource }>();
  const bySource = new Map<TaxonomySource, TaxonomyRow[]>();

  for (const file of listYamlFiles(taxonomyDir)) {
    const raw = parseYaml(readFileSync(file, "utf8"));
    const parsed = taxonomyFileSchema.parse(raw);
    const list = bySource.get(parsed.source) ?? [];
    for (const row of parsed.rows) {
      const key = taxonomyKey({ source: parsed.source, id: row.id });
      if (rows.has(key)) {
        throw new Error(
          `duplicate taxonomy row ${key} (already defined; found again in ${file})`,
        );
      }
      rows.set(key, { ...row, source: parsed.source });
      list.push(row);
    }
    bySource.set(parsed.source, list);
  }

  return { rows, bySource };
}

export function requiresScenarioRows(
  taxonomy: LoadedTaxonomy,
): Array<TaxonomyRow & { source: TaxonomySource }> {
  return [...taxonomy.rows.values()].filter((row) => row.requiresScenario);
}
