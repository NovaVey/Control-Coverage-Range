import { z } from "zod";

/**
 * Where a taxonomy row's authority comes from. External sources anchor the
 * matrix so it can't just grade its own homework; the `gaps/*` sources pull
 * rows directly from each assembled project's own published GAPS.md /
 * CAPABILITY-GAPS.md so this project doesn't get to pick a flattering
 * taxonomy of its own either. `identity` is the one set of rows none of the
 * four projects' own single-layer test suites has any reason to contain —
 * see ARCHITECTURE.md's "Why identity rows are separate" section.
 */
export const TAXONOMY_SOURCES = [
  "owasp-llm",
  "mitre-atlas",
  "identity",
  "gaps/tttb",
  "gaps/principal-graph",
  "gaps/rba",
  "gaps/adc",
  "gaps/control-coverage-range",
] as const;
export type TaxonomySource = (typeof TAXONOMY_SOURCES)[number];

export const taxonomyRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  /** A citation a reader can go verify — a URL for external sources, a file:line-shaped
   * reference for gaps/* rows (matching those projects' own citation discipline). */
  reference: z.string().min(1),
  /** gaps/* rows only: true means the source project itself calls this a live, unresolved
   * limitation (as opposed to a "status: built and shipped" entry recorded for history). */
  stillOpen: z.boolean().optional(),
  /** Every row with requiresScenario:true (the default for gaps/* and identity rows) MUST
   * have at least one scenario referencing it, checked by test/gaps-coverage.spec.ts — this
   * is the mechanism that keeps scenario authorship honest per README's own stated bias risk. */
  requiresScenario: z.boolean().default(true),
});
export type TaxonomyRow = z.infer<typeof taxonomyRowSchema>;

export const taxonomyFileSchema = z.object({
  source: z.enum(TAXONOMY_SOURCES),
  rows: z.array(taxonomyRowSchema),
});
export type TaxonomyFile = z.infer<typeof taxonomyFileSchema>;

export interface TaxonomyRef {
  source: TaxonomySource;
  id: string;
}

export function taxonomyKey(ref: TaxonomyRef): string {
  return `${ref.source}#${ref.id}`;
}
