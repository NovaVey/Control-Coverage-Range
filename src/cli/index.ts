#!/usr/bin/env node
import { Pool } from "pg";
import { loadTaxonomy } from "../taxonomy/load.js";
import { loadAllScenarios, validateTaxonomyRefs } from "../scenario/load.js";
import { runScenario, type RangeConnections } from "../runner/run-scenario.js";
import { validateScenarioCells } from "../scoring/score.js";
import { buildCoverageMatrix } from "../report/matrix.js";
import { renderMarkdown } from "../report/render-markdown.js";
import { renderJsonSnapshot } from "../report/render-json.js";
import {
  findRegressions,
  loadBaseline,
  saveBaseline,
} from "../report/baseline.js";
import { RbaClient } from "../adapters/rba.js";
import { MintClient } from "../adapters/adc.js";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required environment variable: ${name}`);
  return v;
}

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function buildConnections(): Promise<RangeConnections> {
  const pgPool = new Pool({
    connectionString: requireEnv("PRINCIPAL_GRAPH_DATABASE_URL"),
  });
  const rba = new RbaClient(
    requireEnv("RBA_BASE_URL"),
    requireEnv("RBA_ADMIN_API_KEY"),
  );
  const mintBaseUrl = requireEnv("MINT_BASE_URL");
  const mint = new MintClient({
    baseUrl: mintBaseUrl,
    adminApiKey: requireEnv("MINT_ADMIN_API_KEY"),
  });
  const adcRootSecretKey = process.env.MINT_ROOT_SECRET_KEY_B64
    ? b64ToBytes(process.env.MINT_ROOT_SECRET_KEY_B64)
    : undefined;
  const { getPublicKey } = await import("@adc/core");
  if (!adcRootSecretKey)
    throw new Error(
      "MINT_ROOT_SECRET_KEY_B64 is required (the mint service and this CLI must share the same root key)",
    );
  const adcRootPublicKey = getPublicKey(adcRootSecretKey);
  return {
    pgPool,
    rba,
    mint,
    mintBaseUrl,
    adcRootSecretKey,
    adcRootPublicKey,
    principalGraphReportBaseUrl: `http://localhost:8080`,
    principalGraphReportApiKey: requireEnv("PRINCIPAL_GRAPH_REPORT_API_KEY"),
    mintGraphEventsPath: requireEnv("MINT_GRAPH_EVENTS_PATH"),
    graphEventsOffset: { value: 0 },
  };
}

async function cmdRun(outDir: string): Promise<number> {
  const taxonomy = loadTaxonomy();
  const scenarios = loadAllScenarios(`${REPO_ROOT}scenarios`);
  const taxonomyProblems = validateTaxonomyRefs(scenarios, taxonomy);
  if (taxonomyProblems.length > 0) {
    for (const p of taxonomyProblems) console.error(`✗ ${p}`);
    return 1;
  }

  const conn = await buildConnections();
  const results: Array<{
    scenario: (typeof scenarios)[number];
    cells: ReturnType<typeof validateScenarioCells>;
  }> = [];
  let anyInvalid = false;

  for (const scenario of scenarios) {
    console.log(`▶ ${scenario.id}`);
    const result = await runScenario(scenario, conn);
    // A step that threw something callStep() couldn't translate into a clean LayerVerdict
    // (neither AdcGateError nor ToolCallBlockedError — a genuine bug, not a gated deny)
    // leaves that step with an empty verdicts array. Surfacing it here is the difference
    // between "the scorer picked an earlier step's verdict because this one recorded
    // nothing" and a real, intentional outcome — silently falling through to
    // lastMeaningfulVerdict()'s fallback would otherwise misreport a crash as a decision.
    for (const step of result.steps) {
      if (step.threw) {
        anyInvalid = true;
        console.error(
          `  ✗ [step ${step.stepIndex}: ${step.tool}] threw ${step.threw.className}: ${step.threw.message}`,
        );
      }
    }
    const cells = validateScenarioCells(scenario, result);
    for (const c of cells) {
      if (!c.valid) {
        anyInvalid = true;
        console.error(`  ✗ [${c.layer}] claimed ${c.claimed} — ${c.problem}`);
      } else {
        console.log(`  ✓ [${c.layer}] ${c.claimed}`);
      }
    }
    if (result.rebacListUsersOk === false) {
      anyInvalid = true;
      console.error(
        "  ✗ [rebac] expected.rebacListUsers assertion did not hold",
      );
    }
    results.push({ scenario, cells });
  }
  await conn.pgPool.end();

  const matrix = buildCoverageMatrix(results);
  const markdown = renderMarkdown(matrix, taxonomy);
  const snapshot = renderJsonSnapshot(matrix, taxonomy, () =>
    new Date().toISOString(),
  );

  const fs = await import("node:fs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/coverage-matrix.md`, markdown, "utf8");
  fs.writeFileSync(
    `${outDir}/coverage-matrix.json`,
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );
  console.log(`\nWrote ${outDir}/coverage-matrix.md and coverage-matrix.json`);

  return anyInvalid || matrix.anyInvalid ? 1 : 0;
}

async function cmdCheckRegression(outDir: string): Promise<number> {
  const fs = await import("node:fs");
  const snapshot = JSON.parse(
    fs.readFileSync(`${outDir}/coverage-matrix.json`, "utf8"),
  );
  const baselinePath = `${REPO_ROOT}baseline/coverage-matrix.snapshot.json`;
  const baseline = loadBaseline(baselinePath);
  if (!baseline) {
    console.log(
      "No baseline recorded yet — saving this run as the first baseline.",
    );
    saveBaseline(baselinePath, snapshot);
    return 0;
  }
  const regressions = findRegressions(baseline, snapshot);
  if (regressions.length === 0) {
    console.log("No coverage regressions.");
    saveBaseline(baselinePath, snapshot);
    return 0;
  }
  console.error(`${regressions.length} coverage regression(s):`);
  for (const r of regressions) {
    console.error(`  ✗ ${r.row} [${r.layer}]: ${r.from} → ${r.to}`);
  }
  return 1;
}

function usage(): void {
  console.log(
    "usage: ccr <run|report|check-regression|doctor|gaps-coverage> [--out <dir>]",
  );
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const outFlagIndex = rest.indexOf("--out");
  const outDir =
    outFlagIndex >= 0 ? rest[outFlagIndex + 1]! : `${REPO_ROOT}.range-out`;

  switch (cmd) {
    case "run":
      process.exitCode = await cmdRun(outDir);
      return;
    case "check-regression":
      process.exitCode = await cmdCheckRegression(outDir);
      return;
    case "gaps-coverage": {
      const { checkGapsCoverage } =
        await import("../taxonomy/gaps-coverage.js");
      const problems = checkGapsCoverage();
      for (const p of problems) console.error(`✗ ${p}`);
      process.exitCode = problems.length > 0 ? 1 : 0;
      return;
    }
    case "doctor": {
      const conn = await buildConnections();
      console.log("RBA reachable:", await conn.rba.health());
      console.log("Mint service reachable:", await conn.mint.health());
      await conn.pgPool.query("select 1");
      console.log("Principal-Graph Postgres reachable: true");
      await conn.pgPool.end();
      return;
    }
    default:
      usage();
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
