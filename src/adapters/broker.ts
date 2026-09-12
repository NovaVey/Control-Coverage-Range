import {
  createBroker,
  defaultPolicy,
  ToolCallBlockedError,
  type ToolCallBroker,
  type ToolExecutor,
  type PolicyFn,
  type AuditEvent,
  type AuditSink,
  type SinkCapability,
} from "./tttb-lib.js";
import {
  wrapWithAdcGate,
  deriveCallFacts,
  AdcGateError,
  type AdcGateOptions,
} from "@adc/broker";
import { verify as adcCoreVerify, type Facts as AdcFacts } from "@adc/core";
import type { Scenario, ScenarioTool } from "../types/scenario.js";
import type { LayerVerdict } from "../types/layers.js";
import type { RbaClient } from "./rba.js";
import { rbaObject } from "../scenario/identifiers.js";

export interface ActingSubject {
  ns: string;
  id: string;
}

/**
 * A custom PolicyFn that only ever ADDS a BLOCK on top of defaultPolicy's own taint-based
 * verdict, never loosens it — same shape as examples/rbac-policy.ts. This is the concrete
 * mechanism gap-34-identity-blind-policy (taxonomy/gaps/tttb.yaml) checks: whether binding a
 * real RBA `can_call` check to the broker's bound principal actually changes a scenario's
 * outcome versus defaultPolicy alone. Only wired in for scenarios with brokerPolicy:
 * 'rbac-aware' (see buildBrokerSession below) — most scenarios exercise the taint gate on
 * its own, per TTTB's own default.
 */
function rbacAwarePolicy(
  rba: RbaClient,
  actingSubject: ActingSubject,
): PolicyFn {
  return async (call, taint) => {
    const base = await defaultPolicy(call, taint);
    if (base.action === "BLOCK") return base;
    try {
      const result = await rba.check({
        subject: actingSubject,
        relation: "can_call",
        object: { ns: "tool", id: call.toolName },
      });
      if (!result.allowed) {
        return {
          action: "BLOCK",
          reason: `rebac-denied: ${actingSubject.ns}:${actingSubject.id} has no can_call grant on tool:${call.toolName} (RBA /check)`,
        };
      }
    } catch (err) {
      // RBA unreachable — fail closed, the same discipline TTTB's own policyTimeoutMs
      // (GAPS.md #35) applies to a hanging/erroring network-dependent policy.
      return {
        action: "BLOCK",
        reason: `rebac-check-unavailable: RBA unreachable while authorizing "${call.toolName}" (${(err as Error).message})`,
      };
    }
    return base;
  };
}

interface AdcResourceScopedConfig {
  resourceKind: string;
  relation: string;
  resourceIdArg: string;
}

export class BrokerSession {
  readonly broker: ToolCallBroker;
  readonly events: AuditEvent[] = [];
  private readonly wrapped = new Map<string, ToolExecutor>();
  /** Bridges a per-step ADC token into the gate's getToken() closure — see
   * runner/run-scenario.ts, which sets this immediately before each step. A real
   * integration would extract this from the call's own transport (a header, an envelope
   * field); scenario args deliberately don't carry it so the same tool/args pair can be
   * replayed with different tokens across steps. */
  currentAdcToken: string | Uint8Array | undefined;
  private readonly adcGateKind = new Map<
    string,
    "broker-facts" | "resource-scoped"
  >();
  private readonly scenario: Scenario;
  /** Keyed by stack.resources[].id (the scenario-local reference id every other
   * resourceId-shaped scenario field uses — see expected.rebac.check's own doc comment:
   * "reference stack.principals[]/resources[].id") — what a resource-scoped call's own args
   * actually name, e.g. args.resourceId: "prod-config". Used by wrapResourceScoped() to
   * translate that id into the same scoped+sanitized RBA object id
   * (src/scenario/identifiers.ts's rbaObject()) a `scope` caveat naming the identical
   * resource was resolved to at mint time (see run-scenario.ts's resolveScopeCaveats()).
   * Without this, verify()'s own facts.resourceId would never match the token's embedded
   * caveat, and every resource-scoped call would deny with ADC_SCOPE regardless of whether
   * the grant genuinely exists. */
  private readonly resourcesById = new Map<
    string,
    { kind: string; source: string; externalId: string }
  >();

  constructor(
    scenario: Scenario,
    opts: {
      rba: RbaClient;
      actingSubject: ActingSubject;
      adcRootPublicKey: Uint8Array;
      revokedHashes: ReadonlySet<string>;
      /** Fanned out to alongside this session's own in-memory event buffer — the runner
       * wires Principal-Graph's real createPrincipalGraphAuditSink() in here so every
       * gated call's verdict lands in the real, shared identity graph, not a synthetic
       * one this range invents for itself. */
      extraAuditSinks?: AuditSink[];
    },
  ) {
    this.broker = createBroker({
      principal: opts.actingSubject,
      policy:
        scenario.brokerPolicy === "rbac-aware"
          ? rbacAwarePolicy(opts.rba, opts.actingSubject)
          : defaultPolicy,
      policyTimeoutMs: 5_000,
      resetScope: scenario.adversary.resetScope,
      turnDecayWindow: scenario.adversary.turnDecayWindow,
      auditSink: {
        record: (e) => {
          this.events.push(e);
          for (const sink of opts.extraAuditSinks ?? []) sink.record(e);
        },
      },
      // No approvalChannel configured: REQUIRE_APPROVAL always resolves to denied
      // (BrokerOptions.approvalChannel's own documented fail-safe) — a scenario expecting
      // 'approval' asserts that this denial happened via the REQUIRE_APPROVAL branch
      // specifically (see src/scoring/score.ts), not that a human actually granted it.
    });

    this.rootPublicKeyForResourceScoped = opts.adcRootPublicKey;
    this.revokedHashesForResourceScoped = opts.revokedHashes;
    this.scenario = scenario;
    for (const r of scenario.stack.resources) {
      this.resourcesById.set(r.id, r);
    }

    for (const spec of scenario.tools) {
      const raw = buildToolExecutor(spec);

      if (spec.adcGate === "broker-facts") {
        this.adcGateKind.set(spec.name, "broker-facts");
        const adcOpts: AdcGateOptions = {
          rootPublicKey: opts.adcRootPublicKey,
          getToken: () => this.currentAdcToken,
          verifyOptions: { revokedHashes: opts.revokedHashes },
        };
        // wrapWithAdcGate() calls broker.wrap(executor) itself (gate.ts: `const gated =
        // broker.wrap(executor)`) — passing it an ALREADY-wrapped executor (this.broker.wrap(raw))
        // would register the wrapped executor under the same tool name a second time
        // (TTTB's own register()/wrap(): `this.tools.set(tool.name, tool)`), so calling the
        // resulting executor's own execute() recurses into itself via broker.call() before the
        // first invocation ever returns — a genuine ReentrantCallError, confirmed empirically
        // (this was earlier-token-replay's actual failure, not a real ADC/broker finding).
        // raw (never separately wrapped) is the correct, single wrap here.
        this.wrapped.set(spec.name, wrapWithAdcGate(this.broker, raw, adcOpts));
      } else if (spec.adcGate === "resource-scoped") {
        this.adcGateKind.set(spec.name, "resource-scoped");
        if (
          !spec.adcResourceKind ||
          !spec.adcRelation ||
          !spec.adcResourceIdArg
        ) {
          throw new Error(
            `tool "${spec.name}": adcGate:'resource-scoped' requires adcResourceKind/adcRelation/adcResourceIdArg`,
          );
        }
        // wrapResourceScoped() does NOT call broker.wrap() itself — it calls gated.execute()
        // directly (see its own doc comment) — so it needs the already-wrapped executor here,
        // unlike the broker-facts branch above.
        this.wrapped.set(
          spec.name,
          this.wrapResourceScoped(this.broker.wrap(raw), {
            resourceKind: spec.adcResourceKind,
            relation: spec.adcRelation,
            resourceIdArg: spec.adcResourceIdArg,
          }),
        );
      } else {
        this.wrapped.set(spec.name, this.broker.wrap(raw));
      }
    }
  }

  /**
   * Models exactly what @adc/broker's own gate.ts doc comment says a real integrator has
   * to write for a `scope` caveat: "an integrator who wants that gates the specific
   * source tool's own execute() directly, calling @adc/core's verify() with the facts
   * that tool's own request actually names." This is real, hand-rolled equivalent code —
   * not a workaround this range invented to dodge a limitation, but the literal
   * documented alternative — reusing deriveCallFacts()/adcTaintLevel() for the sink/host/
   * taint axes exactly like wrapWithAdcGate does, and adding the resourceKind/resourceId/
   * relation axis wrapWithAdcGate structurally cannot. See
   * taxonomy/identity-controls.yaml's over-broad-delegation row for why THIS is the path
   * where that risk actually lives, not wrapWithAdcGate (which fails closed with
   * ADC_SCOPE for a scope-caveated token, per gate.ts's own confirmed behavior).
   */
  private wrapResourceScoped(
    gated: ToolExecutor,
    cfg: AdcResourceScopedConfig,
  ): ToolExecutor {
    const rootPublicKey = this.rootPublicKeyForResourceScoped;
    const revokedHashes = this.revokedHashesForResourceScoped;
    return {
      ...gated,
      execute: async (args: unknown) => {
        const token = this.currentAdcToken;
        if (token === undefined) {
          throw new AdcGateError(
            gated.name,
            "ADC_MALFORMED",
            "no ADC token supplied for a gated call",
          );
        }
        const rawResourceId = (args as Record<string, unknown>)[
          cfg.resourceIdArg
        ];
        if (typeof rawResourceId !== "string") {
          throw new Error(
            `resource-scoped call to "${gated.name}": args.${cfg.resourceIdArg} must be a string resourceId`,
          );
        }
        // Translate the call's own stack.resources[].id-shaped resourceId into the identical
        // scoped RBA object id a `scope` caveat naming this resource was resolved to at mint
        // time (run-scenario.ts's resolveScopeCaveats()) — see this.resourcesById's own doc
        // comment for why an untranslated resourceId would always deny.
        const resource = this.resourcesById.get(rawResourceId);
        if (!resource) {
          throw new Error(
            `resource-scoped call to "${gated.name}": args.${cfg.resourceIdArg} "${rawResourceId}" references no declared resource`,
          );
        }
        const resourceId = rbaObject(this.scenario, resource).id;
        const callFacts = deriveCallFacts(
          gated,
          args,
          this.broker.scope.watermark.level,
        );
        const facts: AdcFacts = {
          ...callFacts.base,
          sink: callFacts.sinks[0],
          host: callFacts.hosts[0],
          resourceKind: cfg.resourceKind,
          resourceId,
          relation: cfg.relation,
        };
        const result = adcCoreVerify(token, rootPublicKey, facts, {
          revokedHashes,
        });
        if (!result.ok) {
          throw new AdcGateError(gated.name, result.code, result.reason);
        }
        return gated.execute(args);
      },
    };
  }

  private rootPublicKeyForResourceScoped!: Uint8Array;
  private revokedHashesForResourceScoped!: ReadonlySet<string>;

  /** Calls one step's tool through both real gates (ADC first, then the taint gate, per
   * wrapWithAdcGate's own documented ordering) and reduces the outcome into this range's
   * LayerVerdict shape for the 'broker' and 'adc' columns. Never throws — every real error
   * this can produce (AdcGateError, ToolCallBlockedError, or a genuine bug) is captured. */
  async callStep(
    toolName: string,
    args: unknown,
  ): Promise<{ broker: LayerVerdict; adc: LayerVerdict }> {
    const executor = this.wrapped.get(toolName);
    if (!executor)
      throw new Error(`scenario declares no tool named "${toolName}"`);
    const isAdcGated = this.adcGateKind.has(toolName);
    const notApplicableAdc: LayerVerdict = {
      layer: "adc",
      raw: { result: "not-applicable" },
      denied: false,
      requiresApproval: false,
      observed: false,
    };
    try {
      await executor.execute(args);
      return {
        adc: isAdcGated
          ? {
              layer: "adc",
              raw: { result: "allow" },
              denied: false,
              requiresApproval: false,
              observed: true,
            }
          : notApplicableAdc,
        broker: {
          layer: "broker",
          raw: { action: "ALLOW" },
          denied: false,
          requiresApproval: false,
          observed: true,
        },
      };
    } catch (err) {
      if (err instanceof AdcGateError) {
        return {
          adc: {
            layer: "adc",
            raw: { result: "deny", code: err.code },
            denied: true,
            requiresApproval: false,
            reason: `${err.code}: ${err.message}`,
            observed: true,
          },
          // ADC denied before the taint gate was ever reached (both gate paths' own
          // documented ordering) — the broker column has nothing to say about this call.
          broker: {
            layer: "broker",
            raw: { action: "NOT_REACHED" },
            denied: false,
            requiresApproval: false,
            observed: false,
          },
        };
      }
      if (err instanceof ToolCallBlockedError) {
        return {
          adc: isAdcGated
            ? {
                layer: "adc",
                raw: { result: "allow" },
                denied: false,
                requiresApproval: false,
                observed: true,
              }
            : notApplicableAdc,
          broker: {
            layer: "broker",
            raw: { action: err.decision.action },
            denied: err.decision.action !== "REQUIRE_APPROVAL",
            requiresApproval: err.decision.action === "REQUIRE_APPROVAL",
            reason: "reason" in err.decision ? err.decision.reason : undefined,
            observed: true,
            detail: {
              taint: {
                scopeLevel: err.taint.scopeLevel,
                sinkClass: err.taint.sinkClass,
              },
            },
          },
        };
      }
      throw err;
    }
  }
}

function buildToolExecutor(spec: ScenarioTool): ToolExecutor {
  const mockResult =
    typeof spec.mockResult === "string"
      ? spec.mockResult
      : (spec.mockResult as { mockResult: unknown }).mockResult;
  return {
    name: spec.name,
    capabilities: {
      capabilities: (spec.capabilities ?? []) as SinkCapability[],
      readsPrivateData: spec.readsPrivateData
        ? { categories: ["scenario-declared"] }
        : undefined,
      irreversible: spec.irreversible,
    },
    isSource: spec.isSource,
    trusted: spec.trusted,
    sourceClass: spec.sourceClass,
    destinationKeys: spec.destinationKeys,
    mayCallSummarize: spec.mayCallSummarize,
    async execute() {
      return mockResult;
    },
  };
}
