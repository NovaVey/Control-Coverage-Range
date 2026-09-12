/**
 * The four columns of the coverage matrix — one per real project this range
 * assembles. Each is a distinct control that can independently see (or miss)
 * a given attack technique; see ARCHITECTURE.md for how each is wired in.
 */
export const LAYERS = ["broker", "adc", "rebac", "identity-graph"] as const;
export type Layer = (typeof LAYERS)[number];

export const LAYER_LABELS: Record<Layer, string> = {
  broker: "Taint-Tracked-Tool-Broker",
  adc: "Attenuated-Delegation-Chain",
  rebac: "Relationship-Based-Authorization",
  "identity-graph": "Principal-Graph",
};

/**
 * The five cell outcomes. `blocked-incidentally` is the one that does the
 * actual work this project exists to do: a deny that happened for a reason
 * unrelated to the technique under test is not coverage, and the scorer
 * (src/scoring/score.ts) is required to check *why* a layer denied a call,
 * not merely *whether* it did, before ever writing `blocked`.
 */
export const OUTCOMES = [
  "blocked",
  "approval",
  "observed-only",
  "missed",
  "blocked-incidentally",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  blocked: "Blocked",
  approval: "Approval",
  "observed-only": "Observed-only",
  missed: "Missed",
  "blocked-incidentally": "Blocked-incidentally",
};

/** Ranking used only for the markdown/HTML renderers' colour scale — never for scoring. */
export const OUTCOME_SEVERITY: Record<Outcome, number> = {
  blocked: 0,
  approval: 1,
  "observed-only": 2,
  "blocked-incidentally": 3,
  missed: 4,
};

export interface LayerVerdict {
  layer: Layer;
  /** What actually happened, in that layer's own native verdict vocabulary. */
  raw: unknown;
  /** True iff the call was prevented from taking effect at this layer. */
  denied: boolean;
  /** True iff the layer surfaced the call for a human decision rather than an outright allow/deny. */
  requiresApproval: boolean;
  /** The layer's own stated reason/error code for its verdict, if any — this is what reasonMatches checks against. */
  reason?: string;
  /** True iff this layer recorded the event somewhere inspectable even though it did not gate it. */
  observed: boolean;
  /** Anything the adapter wants attached to the report for this cell (raw response bodies, etc). */
  detail?: Record<string, unknown>;
}

export interface StepResult {
  stepIndex: number;
  tool: string;
  verdicts: LayerVerdict[];
  /** Set if calling the tool itself threw — most gated calls end this way (ToolCallBlockedError, AdcGateError, ...). */
  threw?: { className: string; message: string };
}
