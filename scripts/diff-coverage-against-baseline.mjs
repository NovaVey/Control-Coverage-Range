#!/usr/bin/env node
// Compares a freshly generated coverage-matrix.json (from a submodule-drift run against
// each assembled project's own CURRENT HEAD) against the committed baseline
// (baseline/coverage-matrix.snapshot.json — main's own PINNED-submodule state, per
// .gitmodules). Symmetric: any row x layer whose outcome differs, in EITHER direction —
// an improvement counts as drift too, not just a regression, unlike src/report/
// baseline.ts's own findRegressions(), which is deliberately asymmetric for the real CI
// gate. This script never fails: a moved matrix here is information for a human to act
// on (bump .gitmodules for real, or investigate), not something this job itself should
// gate — see .github/workflows/submodule-drift.yml's own module comment.
//
// usage: diff-coverage-against-baseline.mjs <baseline.json> <current.json> <out.md>
// Writes <out.md> ONLY when there's something to report (drift found, or the corpus
// itself failed to produce <current.json> at all) — its mere existence is what the
// calling workflow checks to decide whether to open an issue.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [, , baselinePath, currentPath, outPath] = process.argv;
if (!baselinePath || !currentPath || !outPath) {
  console.error(
    'usage: diff-coverage-against-baseline.mjs <baseline.json> <current.json> <out.md>',
  );
  process.exit(1);
}

if (!existsSync(currentPath)) {
  writeFileSync(
    outPath,
    "The scenario corpus did not produce a coverage-matrix.json when run against each " +
      "assembled project's current HEAD — the stack itself failed to come up, or the run " +
      'crashed before writing output. That is itself worth knowing: see this run\'s own ' +
      'job logs (and its "Compose logs" step) for what actually happened.\n',
    'utf8',
  );
  console.log('Drift report: corpus failed to complete against current HEAD.');
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.log('No committed baseline yet — nothing to compare drift against.');
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const current = JSON.parse(readFileSync(currentPath, 'utf8'));

const rowKeys = new Set([
  ...Object.keys(baseline.rows ?? {}),
  ...Object.keys(current.rows ?? {}),
]);

const changes = [];
for (const key of [...rowKeys].sort()) {
  const baseRow = baseline.rows?.[key];
  const curRow = current.rows?.[key];
  const name = curRow?.name ?? baseRow?.name ?? key;
  const layers = new Set([
    ...Object.keys(baseRow?.cells ?? {}),
    ...Object.keys(curRow?.cells ?? {}),
  ]);
  for (const layer of [...layers].sort()) {
    const from = baseRow?.cells?.[layer]?.outcome;
    const to = curRow?.cells?.[layer]?.outcome;
    if (from !== to) {
      changes.push({
        key,
        name,
        layer,
        from: from ?? '(no cell)',
        to: to ?? '(no cell)',
      });
    }
  }
}

if (changes.length === 0) {
  console.log(
    'No drift: the matrix produced against each project\'s current HEAD matches the committed baseline exactly.',
  );
  process.exit(0);
}

const lines = [
  `${changes.length} cell(s) differ between the committed baseline (each project's own ` +
    "pinned commit, per .gitmodules) and a run against each project's current HEAD:",
  '',
  '| Taxonomy row | Layer | Baseline (pinned) | Current HEAD |',
  '|---|---|---|---|',
  ...changes.map((c) => `| ${c.name} | ${c.layer} | ${c.from} | ${c.to} |`),
];
writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`${changes.length} cell(s) drifted — see ${outPath}`);
