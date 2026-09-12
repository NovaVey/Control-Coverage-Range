/**
 * Principal-Graph ships no npm package export and no src/index.ts (confirmed:
 * package.json declares "main": "dist/index.js" but nothing under src/
 * produces that file — itself one of this range's own findings, see
 * taxonomy/gaps/principal-graph.yaml's no-write-http-api row and
 * ARCHITECTURE.md). The only way to reuse its real, tested identity/audit
 * code — rather than re-implementing the same upsert/audit-sink logic a
 * second time, independently, the exact failure mode this whole project
 * exists to catch — is a relative import straight into its own build
 * output. This file is the ONE place that fragile relative path lives;
 * every other adapter imports from here instead of reaching into
 * stack/principal-graph/dist directly.
 *
 * Requires `stack/principal-graph` to have been built first (`npm ci &&
 * npm run build` inside that directory — see README's own "Build order"
 * section). Nothing here works against the submodule's un-built src/ —
 * Principal-Graph's own tsconfig.json target (NodeNext) requires compiled
 * output for exactly the same reason this range's own code does. Its
 * tsconfig has no explicit `rootDir`, so tsc infers one from the common
 * ancestor of src/**,test/**,scripts/** (the package root) — output lands
 * under dist/src/... , dist/test/..., dist/scripts/..., NOT dist/... —
 * confirmed directly against a real build, not assumed from package.json's
 * own (unbuilt, misleading) "main": "dist/index.js".
 */
export {
  ensurePrincipal,
  ensureResource,
  type PrincipalSighting,
  type ResourceSighting,
  type Queryable,
} from "../../stack/principal-graph/dist/src/upsert.js";

export { createPool } from "../../stack/principal-graph/dist/src/db.js";

export {
  createPrincipalGraphAuditSink,
  type BrokerAuditSinkOptions,
  type PrincipalGraphAuditSink,
  type BrokerPrincipalIdentity,
} from "../../stack/principal-graph/dist/src/adapters/broker-audit-sink.js";

export {
  createAdcGraphSink,
  type AdcGraphSink,
  type AdcGraphEvent,
  type AdcGraphAction,
  type AdcIdentity,
} from "../../stack/principal-graph/dist/src/adapters/adc-graph-sink.js";

export {
  evaluatePolicies,
  POLICIES,
  type PolicyRule,
  type PolicyViolation,
} from "../../stack/principal-graph/dist/src/policies.js";

export type {
  PrincipalKind,
  ResourceKind,
  Relation,
  GrantEdge,
  Decision,
} from "../../stack/principal-graph/dist/src/model.js";
