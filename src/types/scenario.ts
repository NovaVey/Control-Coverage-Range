import { z } from "zod";

/**
 * Scenario file schema. A scenario declares initial state across all four
 * real layers, a tool inventory, one scripted adversary session, and the
 * outcome the scorer should reach for every taxonomy row it claims to
 * exercise. See ARCHITECTURE.md "Scenario shape" and schema/README.md for
 * the field-by-field rationale; the types here are the single source of
 * truth (no separately-maintained JSON Schema to drift out of sync).
 */

// ---- Layer-native vocabularies, copied verbatim from each real project ----

/** taint-tracked-tool-broker's SinkCapability union (src/types.ts) */
const SINK_CAPABILITIES = [
  "exec:shell",
  "exec:code",
  "write:fs",
  "write:external-account",
  "finance:purchase",
  "write:agent-memory",
  "irreversible:other",
  "net:outbound",
  "net:email",
  "net:api-call",
  "net:post-message",
] as const;

/** taint-tracked-tool-broker's PolicyDecision['action'] (src/types.ts) */
const BROKER_DECISIONS = [
  "ALLOW",
  "ALLOW_WITH_WARNING",
  "REQUIRE_APPROVAL",
  "BLOCK",
  "QUARANTINE_AND_RETRY",
] as const;

/** @adc/core's ReasonCode (packages/adc-core/src/errors.ts) */
const ADC_REASON_CODES = [
  "ADC_MALFORMED",
  "ADC_SIG_INVALID",
  "ADC_PROOF_INVALID",
  "ADC_REVOKED",
  "ADC_EXPIRED",
  "ADC_DEPTH_EXCEEDED",
  "ADC_SCOPE",
  "ADC_SINK",
  "ADC_TAINT",
  "ADC_HOST",
  "ADC_AUDIENCE",
] as const;

/** @adc/core's closed caveat vocabulary (packages/adc-core/src/caveats.ts) */
const caveatSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("scope"),
    triples: z.array(z.tuple([z.string(), z.string(), z.string()])), // [resourceKind, resourceId, relation] — resourceId may be '*'
  }),
  z.object({ kind: z.literal("sinks"), classes: z.array(z.string()) }),
  z.object({
    kind: z.literal("taint_max"),
    level: z.enum(["TRUSTED", "DERIVED", "RAW_UNTRUSTED"]),
  }),
  z.object({ kind: z.literal("expires"), at: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal("max_depth"),
    depth: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("hosts"), hostnames: z.array(z.string()) }),
  z.object({ kind: z.literal("aud"), verifier: z.string() }),
]);
export type ScenarioCaveat = z.infer<typeof caveatSchema>;

/** principal-graph's Principal.kind (src/model.ts) */
const PRINCIPAL_KINDS = ["human", "agent", "service"] as const;

/** principal-graph's src/policies.ts POLICIES rule kinds this range can assert against /report.json */
const POLICY_RULE_KINDS = [
  "no-trifecta",
  "stale-grant",
  "chain-intact",
  "on-behalf-of-escalation",
  "adapter-freshness",
  "delegation-depth",
  "over-broad-root-token",
] as const;

// ---- Seed state (fed into each layer before the adversary session runs) ----

const principalSchema = z.object({
  id: z.string().min(1), // scenario-local reference id, not principal-graph's own uuid
  kind: z.enum(PRINCIPAL_KINDS),
  source: z.string().default("control-coverage-range"),
  externalId: z.string().min(1),
  displayName: z.string().optional(),
});

const resourceSchema = z.object({
  id: z.string().min(1), // scenario-local reference id
  kind: z.string().min(1), // e.g. 'repo' | 'bucket' | 'db' | 'tool' | 'group' | 'adc_block' — see resource-vocabulary.ts
  source: z.string().default("control-coverage-range"),
  externalId: z.string().min(1),
  displayName: z.string().optional(),
});

const grantSchema = z.object({
  principalId: z.string().min(1), // references principals[].id
  resourceId: z.string().min(1), // references resources[].id
  relation: z.string().min(1),
  source: z.string().default("control-coverage-range"),
  /** Seed this grant already revoked — for stale-grant / revoked-but-still-honored scenarios. */
  revokedAt: z.string().datetime().optional(),
});

const rebacTupleSchema = z.object({
  objectNs: z.string().min(1),
  objectId: z.string().min(1),
  relation: z.string().min(1),
  subjectNs: z.string().min(1),
  subjectId: z.string().min(1),
  subjectRelation: z.string().optional(), // userset subject, e.g. group#member
});

const rebacSchema = z
  .object({
    /** '.authz' DSL source to POST /schema/publish before seeding tuples. Omit to reuse
     * whatever schema an earlier scenario in the same run already published (namespace
     * publish is additive/versioned — see RBA's docs/DECISIONS.md — so re-publishing the
     * identical example schema across scenarios in one run is a harmless no-op version bump). */
    schema: z.string().optional(),
    /** Extra tuples beyond the 1:1 mirror of `grants[]` the runner derives automatically
     * (see src/scenario/seed.ts's grantsToRebacTuples()) — e.g. group-nesting fixtures. */
    tuples: z.array(rebacTupleSchema).default([]),
  })
  .default({ tuples: [] });

const adcMintSchema = z.object({
  /** references stack.principals[].id — the runner resolves the actual RBA-shaped
   * {ns:'principal', id} via src/scenario/identifiers.ts's rbaSubject(), the exact
   * subject shape the mint service's own bounding.ts sends on to RBA's POST /scope
   * and POST /check. */
  subjectPrincipalId: z.string().min(1),
  caveats: z.array(caveatSchema).default([]),
});

const adcTokenSchema = z.object({
  id: z.string().min(1), // scenario-local reference id
  /** 'mint' drives the real HTTP mint service (POST /mint), which itself calls RBA's real
   * POST /scope / POST /check to bound the requested scope — the intended, real path.
   * 'offline' calls @adc/core's mintRoot()/attenuate() in-process with no RBA bounding at
   * all, for scenarios that need to construct a chain shape the real bounded mint would
   * refuse to issue (e.g. modeling a token minted before this range existed, or a
   * deliberately-adversarial chain for a differential-fuzzer-style property check). */
  via: z.enum(["mint", "offline"]),
  mint: adcMintSchema.optional(),
  offline: z
    .object({
      rootCaveats: z.array(caveatSchema).default([]),
      /** Each entry attenuates the previous block by appending these caveats. */
      attenuations: z.array(z.array(caveatSchema)).default([]),
      sealed: z.boolean().default(false),
    })
    .optional(),
});

const toolSchema = z.object({
  name: z.string().min(1),
  capabilities: z.array(z.enum(SINK_CAPABILITIES)).default([]),
  isSource: z.boolean().optional(),
  trusted: z.boolean().optional(),
  sourceClass: z.string().optional(),
  destinationKeys: z.array(z.string()).optional(),
  mayCallSummarize: z.boolean().optional(),
  readsPrivateData: z.boolean().optional(),
  irreversible: z.boolean().optional(),
  /** Whether/how this tool is ADC-gated. 'none' (default): no ADC check at all — most
   * tools in most scenarios. 'broker-facts': wrapWithAdcGate as shipped — verifies
   * sinks/hosts/taint_max/expires/max_depth/aud caveats using facts derived from live
   * broker state; a 'scope' caveat on a token checked this way ALWAYS denies with
   * ADC_SCOPE, confirmed directly in @adc/broker's own gate.ts doc comment: this generic
   * adapter has no way to derive resourceKind/resourceId/relation facts at all. 'resource-scoped':
   * models what that same doc comment says a real integrator has to write instead — a
   * tool's own execute() calling @adc/core's verify() directly with resourceKind/relation
   * fixed on the tool and resourceId read from the call's own args (adcResourceIdArg) —
   * see taxonomy/identity-controls.yaml's over-broad-delegation row for why this path,
   * not wrapWithAdcGate, is where that risk actually lives. */
  adcGate: z.enum(["none", "broker-facts", "resource-scoped"]).default("none"),
  adcResourceKind: z.string().optional(),
  adcRelation: z.string().optional(),
  /** Which key in a call's args names the resourceId to check — only meaningful when
   * adcGate:'resource-scoped'. */
  adcResourceIdArg: z.string().optional(),
  /** What execute() returns when the adversary calls this tool and nothing blocks it.
   * A string is registered as source text verbatim (matches the injection-corpus fixture
   * convention in the broker's own corpus/fixtures.ts); use { mockResult } for non-string
   * results. */
  mockResult: z
    .union([z.string(), z.object({ mockResult: z.unknown() })])
    .default(""),
});

// ---- The adversary session ----

const stepSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  /** references adc.tokens[].id — the token this call presents to wrapWithAdcGate's getToken. */
  adcToken: z.string().optional(),
  /** Calls broker.startNewTurn() immediately before this step — a no-op unless
   * adversary.resetScope is 'turn'/'turn-decay' (BrokerOptions.resetScope's own
   * documented behavior). Models a real turn boundary for cross-turn-latent-influence
   * / agent-memory-cross-session-laundering style scenarios. */
  startNewTurnBefore: z.boolean().default(false),
});

const adversarySchema = z.object({
  mode: z.enum(["scripted", "live-model"]).default("scripted"),
  /** Threaded straight into BrokerOptions.resetScope — default 'session' matches
   * TTTB's own default. */
  resetScope: z.enum(["turn", "session", "turn-decay"]).default("session"),
  turnDecayWindow: z.number().int().positive().optional(),
  /** Which seeded principal is bound as BrokerOptions.principal and (via adcToken) the
   * calling identity for every step — one broker instance = one session = one actor,
   * matching TTTB's own GAPS.md #19 model. A scenario modeling a delegation hop seeds the
   * upstream principal's actions as scenario state (grants/mints), not as adversary steps. */
  actingPrincipalId: z.string().min(1),
  /** references principals[].id — fed to Principal-Graph's own real
   * createPrincipalGraphAuditSink() as `onBehalfOf`, fixed for the whole
   * session (that function's own documented grain — see
   * src/adapters/broker.ts). This is how a confused-deputy/on-behalf-of
   * scenario actually reaches Principal-Graph's on-behalf-of-escalation
   * policy through the broker's own real audit trail, not a synthetic one. */
  onBehalfOfPrincipalId: z.string().optional(),
  /** Calls broker.markSystemPromptExposure(note, text) before any step runs — the
   * documented escape hatch for a channel the broker can't see structurally (system
   * prompt content reaching the model with no tracked tool call at all,
   * taint-tracked-tool-broker GAPS.md #1). Modeling "the integrator actually used the
   * escape hatch" as an explicit, separate choice from the untracked-channel scenarios
   * (which model NOT using it) is deliberate — see those scenarios' own rationale. */
  systemPromptExposureBefore: z
    .object({ note: z.string(), text: z.string().optional() })
    .optional(),
  /** May be empty — a scenario purely about the rebac or identity-graph column (e.g. a
   * schema-isolation question with no tool call in the picture at all) has nothing for
   * the broker/ADC session to do. */
  steps: z.array(stepSchema).default([]),
});

// ---- Expectations ----

const brokerExpectationSchema = z.object({
  decision: z.enum(BROKER_DECISIONS),
  /** Regex (via new RegExp(pattern)) checked against the actual PolicyDecision.reason /
   * ToolCallBlockedError message. Required whenever decision denies/gates the call — an
   * absent reasonMatches on a denying expectation is a lint error (see
   * test/schema.spec.ts): a bare "it was blocked" claim is exactly the self-deception this
   * project exists to catch (a wrong-reason deny scores blocked-incidentally, never blocked). */
  reasonMatches: z.string().optional(),
  /** Which adversary.steps[] index this expectation actually judges — src/scoring/score.ts's
   * lastMeaningfulVerdict() otherwise scans from the last step backward and returns the
   * first *observed* verdict it finds, which in practice is always the last step (an ALLOW
   * is observed:true same as a deny), silently requiring the decisive call to be the final
   * one. Absent (the common case — one decisive call, usually the last) falls back to that
   * same last-observed-verdict behavior; set this whenever an EARLIER step is the one this
   * cell's claim is actually about (see earlier-token-replay.yaml's own two-step shape). */
  atStep: z.number().int().nonnegative().optional(),
});

const adcExpectationSchema = z.object({
  result: z.enum(["allow", "deny"]),
  code: z.enum(ADC_REASON_CODES).optional(),
  reasonMatches: z.string().optional(),
  /** Same escape hatch as brokerExpectationSchema.atStep, for the adc column. */
  atStep: z.number().int().nonnegative().optional(),
});

const rebacExpectationSchema = z.object({
  /** An independent, direct /check the range makes itself (not derived from the broker or
   * ADC's own decisions) — this is what "the check engine, asked the same question a real
   * app-authorization call site would ask" means for this row. subjectPrincipalId/
   * objectResourceId reference stack.principals[]/resources[].id — the runner resolves the
   * actual RBA {ns,id} via src/scenario/identifiers.ts so a scenario author never has to
   * hand-keep a raw subject/object id in sync with the per-scenario scoping scheme. */
  check: z.object({
    subjectPrincipalId: z.string().min(1),
    relation: z.string().min(1),
    objectResourceId: z.string().min(1),
  }),
  allowed: z.boolean(),
});

const rebacListUsersExpectationSchema = z.object({
  /** references stack.resources[].id + a relation/permission name. */
  objectResourceId: z.string().min(1),
  relation: z.string().min(1),
  expectUnenumerable: z.boolean(),
});

const identityGraphExpectationSchema = z.object({
  /** Which src/policies.ts violations (if any) must appear in GET /report.json after the
   * scenario's seed + adversary steps have run. Empty array asserts none of these fire. */
  violations: z.array(z.enum(POLICY_RULE_KINDS)).default([]),
});

const cellSchema = z.object({
  outcome: z.enum([
    "blocked",
    "approval",
    "observed-only",
    "missed",
    "blocked-incidentally",
  ]),
  /** Required, no default — every cell's outcome must be argued for in plain language,
   * especially missed/blocked-incidentally (see ARCHITECTURE.md "The output is the
   * product"). Reviewed the same way a corpus case's own `notes` field is. */
  rationale: z.string().min(1),
  layer: z.enum(["broker", "adc", "rebac", "identity-graph"]),
});

const taxonomyRefSchema = z.object({
  source: z.enum([
    "owasp-llm",
    "mitre-atlas",
    "identity",
    "gaps/tttb",
    "gaps/principal-graph",
    "gaps/rba",
    "gaps/adc",
    "gaps/control-coverage-range",
  ]),
  id: z.string().min(1),
});

export const scenarioSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "scenario id must be kebab-case"),
  title: z.string().min(1),
  summary: z.string().min(1),
  taxonomy: z.array(taxonomyRefSchema).min(1),
  /** True for a scenario whose whole point is demonstrating a known, disclosed gap (mirrors
   * the broker's own corpus TRUE KNOWN GAP convention). A missed/observed-only cell from a
   * scenario with assertsKnownGap:true is expected and never flags as a coverage
   * regression on its own; one from a scenario without it always does. */
  assertsKnownGap: z.boolean().default(false),
  liveModelNote: z.string().optional(),
  /** 'default' runs TTTB's own defaultPolicy unmodified (most scenarios — the taint gate
   * alone). 'rbac-aware' additionally consults a real RBA `can_call` check keyed on the
   * acting principal before allowing anything defaultPolicy didn't already BLOCK — this is
   * the concrete mechanism gap-34-identity-blind-policy (taxonomy/gaps/tttb.yaml) exists to
   * exercise, so only scenarios about that row opt into it (see src/adapters/broker.ts). */
  brokerPolicy: z.enum(["default", "rbac-aware"]).default("default"),
  stack: z.object({
    principals: z.array(principalSchema).default([]),
    resources: z.array(resourceSchema).default([]),
    grants: z.array(grantSchema).default([]),
    rebac: rebacSchema,
    adcTokens: z.array(adcTokenSchema).default([]),
    /** Token ids (from adcTokens[].id, via:'mint' only) to revoke through the mint
     * service's real POST /revoke before the adversary session runs. */
    adcRevoked: z.array(z.string()).default([]),
    /** Applied AFTER every adcTokens[] entry has been minted, but BEFORE the adversary
     * session runs — models "a grant was live when a token was minted against it, then
     * revoked, with the token itself never told" (see identity#stale-grant-abuse): a
     * Postgres UPDATE grant_edge SET revoked_at=now() plus a real RBA DELETE /tuples for
     * the matching tuple. A grant listed here must already be a live entry in
     * stack.grants[] with no revokedAt of its own (that field means "seed already
     * revoked, before anything else runs" — a different, earlier point in time). */
    revokeAfterMint: z
      .array(
        z.object({
          principalId: z.string(),
          resourceId: z.string(),
          relation: z.string(),
        }),
      )
      .default([]),
    /** Principal-Graph's own src/policies.ts ships 4 more PolicyRule kinds beyond the
     * always-on default 3 (no-trifecta, stale-grant, on-behalf-of-escalation) —
     * deliberately opt-in because each needs a deployment-specific number that
     * project's own adapters refuse to guess (see taxonomy/gaps/principal-graph.yaml's
     * opt-in-policies-not-run-by-default row). A scenario about one of those rows
     * configures it explicitly here, exactly as a real deployment would have to. */
    principalGraphExtraPolicies: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("chain-intact") }),
          z.object({
            kind: z.literal("adapter-freshness"),
            adapter: z.string(),
            maxAgeHours: z.number(),
          }),
          z.object({
            kind: z.literal("delegation-depth"),
            maxDepth: z.number().int().nonnegative(),
          }),
          z.object({
            kind: z.literal("over-broad-root-token"),
            minOwnedResources: z.number().int().nonnegative(),
            minRatio: z.number(),
          }),
        ]),
      )
      .default([]),
  }),
  /** May be empty — see adversary.steps's own doc comment. */
  tools: z.array(toolSchema).default([]),
  adversary: adversarySchema,
  expected: z.object({
    broker: brokerExpectationSchema.optional(),
    adc: adcExpectationSchema.optional(),
    rebac: rebacExpectationSchema.optional(),
    rebacListUsers: rebacListUsersExpectationSchema.optional(),
    identityGraph: identityGraphExpectationSchema.optional(),
    cells: z.array(cellSchema).min(1),
  }),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioTool = z.infer<typeof toolSchema>;
export type ScenarioStep = z.infer<typeof stepSchema>;
