import type { Scenario } from "../types/scenario.js";
import type {
  LayerVerdict,
  Layer,
  Outcome,
  StepResult,
} from "../types/layers.js";
import type { ScenarioRunResult } from "../runner/run-scenario.js";

/**
 * This range does not invent the coverage outcome for a scenario — the scenario's own
 * `expected.cells[]` DECLARES it, argued in plain language via `rationale` (mirroring
 * every corpus case's own `notes` field convention). What this module does is VALIDATE
 * that declaration against the real, empirical verdicts the runner collected — the
 * mechanism that stops a claimed `blocked` from quietly being a `blocked-incidentally`,
 * or a claimed `observed-only` from quietly being a `missed`. A scenario whose claimed
 * outcome doesn't hold up is a scenario-authoring bug (or, on the very first real CI
 * run against this corpus, evidence the author's own reading of the source was wrong —
 * see taxonomy/gaps/control-coverage-range.yaml's
 * expectations-not-empirically-run-at-build-time row) and is reported as a hard finding,
 * never silently accepted.
 *
 * Two of the four columns (rebac, identity-graph) never gate a call in this range's own
 * architecture at all — RBA's independent /check and Principal-Graph's policy report are
 * both deliberately after-the-fact/diagnostic here (see ARCHITECTURE.md's "Two columns
 * are diagnostic, two columns gate" section), so their reachable outcome set is
 * structurally narrower: {observed-only, missed}, never blocked/approval/
 * blocked-incidentally. Claiming one of those for either column is rejected outright as
 * a scenario-authoring error, not silently reinterpreted.
 */

export interface CellValidation {
  layer: Layer;
  claimed: Outcome;
  rationale: string;
  valid: boolean;
  /** Present iff !valid — what the empirical verdict actually shows instead. */
  problem?: string;
}

function reasonMatches(
  reason: string | undefined,
  pattern: string | undefined,
): boolean {
  if (!pattern) return true; // no pattern declared — nothing to check against
  if (!reason) return false; // a pattern was declared but the layer gave no reason to check
  return new RegExp(pattern).test(reason);
}

function lastMeaningfulVerdict(
  steps: StepResult[],
  layer: Layer,
): LayerVerdict | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const v = steps[i]!.verdicts.find((v) => v.layer === layer);
    if (v && v.observed) return v;
  }
  return steps.at(-1)?.verdicts.find((v) => v.layer === layer);
}

function codeMatches(
  verdict: LayerVerdict,
  expectedCode: string | undefined,
): boolean {
  if (!expectedCode) return true;
  return (verdict.raw as { code?: string } | undefined)?.code === expectedCode;
}

function validateGatingLayer(
  layer: "broker" | "adc",
  claimed: Outcome,
  verdict: LayerVerdict | undefined,
  expectedReasonPattern: string | undefined,
  expectedCode: string | undefined,
): CellValidation["problem"] | undefined {
  if (!verdict)
    return `no ${layer} verdict was recorded for this scenario's steps`;
  switch (claimed) {
    case "blocked":
      if (verdict.requiresApproval)
        return `${layer} actually required approval, not an outright block`;
      if (!verdict.denied)
        return `${layer} actually allowed the call through — nothing was blocked`;
      if (!codeMatches(verdict, expectedCode)) {
        return `${layer} denied the call with code ${(verdict.raw as { code?: string } | undefined)?.code ?? "(none)"}, not the expected ${expectedCode} — this is blocked-incidentally, not blocked`;
      }
      if (!reasonMatches(verdict.reason, expectedReasonPattern)) {
        return `${layer} denied the call, but for a reason that doesn't match this scenario's own mechanism (${layer} said: ${verdict.reason ?? "(no reason recorded)"}) — this is blocked-incidentally, not blocked`;
      }
      return undefined;
    case "approval":
      if (layer !== "broker")
        return `${layer} has no approval concept in this stack — only 'broker' can reach 'approval'`;
      if (!verdict.requiresApproval)
        return `${layer} did not require approval (denied=${verdict.denied})`;
      return undefined;
    case "missed":
      if (verdict.denied || verdict.requiresApproval) {
        const code = (verdict.raw as { code?: string } | undefined)?.code;
        return `${layer} actually gated this call (denied=${verdict.denied}, requiresApproval=${verdict.requiresApproval}${code ? `, code=${code}` : ""}${verdict.reason ? `, reason=${verdict.reason}` : ""}) — it was not missed`;
      }
      return undefined;
    case "blocked-incidentally":
      if (!verdict.denied)
        return `${layer} did not deny the call at all, so there is nothing incidental to report`;
      if (
        expectedReasonPattern &&
        reasonMatches(verdict.reason, expectedReasonPattern)
      ) {
        return `${layer}'s denial reason actually DOES match this scenario's own mechanism — this is 'blocked', not blocked-incidentally`;
      }
      return undefined;
    case "observed-only":
      return `${layer} can gate a call outright in this stack — an 'observed-only' claim for it is never valid here (use 'missed' if nothing stopped it, or 'blocked'/'blocked-incidentally' if something did)`;
  }
}

function validateDiagnosticLayer(
  layer: "rebac" | "identity-graph",
  claimed: Outcome,
  verdict: LayerVerdict | undefined,
): CellValidation["problem"] | undefined {
  if (
    claimed === "blocked" ||
    claimed === "approval" ||
    claimed === "blocked-incidentally"
  ) {
    return `'${layer}' never gates a call in this range's own architecture (see ARCHITECTURE.md) — only 'observed-only' or 'missed' are reachable claims here`;
  }
  if (!verdict) return `no ${layer} verdict was recorded for this scenario`;
  const wouldHaveCaught =
    layer === "rebac"
      ? Boolean(
          (verdict.detail as { wouldHaveDenied?: boolean } | undefined)
            ?.wouldHaveDenied,
        )
      : verdict.observed;
  if (claimed === "observed-only" && !wouldHaveCaught) {
    return `${layer} did not actually observe/would-not-have-caught this — the claim should be 'missed'`;
  }
  if (claimed === "missed" && wouldHaveCaught) {
    return `${layer} DID observe/would have caught this — the claim should be 'observed-only', not 'missed'`;
  }
  return undefined;
}

export function validateScenarioCells(
  scenario: Scenario,
  result: ScenarioRunResult,
): CellValidation[] {
  return scenario.expected.cells.map((cell) => {
    let problem: string | undefined;
    if (cell.layer === "broker" || cell.layer === "adc") {
      const verdict = lastMeaningfulVerdict(result.steps, cell.layer);
      const pattern =
        cell.layer === "broker"
          ? scenario.expected.broker?.reasonMatches
          : scenario.expected.adc?.reasonMatches;
      const code =
        cell.layer === "adc" ? scenario.expected.adc?.code : undefined;
      problem = validateGatingLayer(
        cell.layer,
        cell.outcome,
        verdict,
        pattern,
        code,
      );
    } else {
      const verdict =
        cell.layer === "rebac" ? result.rebac : result.identityGraph;
      problem = validateDiagnosticLayer(cell.layer, cell.outcome, verdict);
    }
    return {
      layer: cell.layer,
      claimed: cell.outcome,
      rationale: cell.rationale,
      valid: problem === undefined,
      problem,
    };
  });
}

/** A scenario with assertsKnownGap:true is EXPECTED to carry a missed/blocked-incidentally
 * cell — that alone is never a regression. A scenario without it carrying one, when the
 * previously-recorded baseline for that exact (scenario, layer) pair was better, is
 * exactly what src/report/baseline.ts's regression gate exists to catch. */
export function isExpectedGap(
  scenario: Scenario,
  cell: CellValidation,
): boolean {
  return (
    scenario.assertsKnownGap &&
    (cell.claimed === "missed" || cell.claimed === "blocked-incidentally")
  );
}
