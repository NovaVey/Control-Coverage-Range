/**
 * Principal-Graph now ships a real package export: `src/index.ts` re-exports exactly
 * what an outside consumer needs (identity upsert, the pool constructor, the two sinks a
 * live broker/@adc/graph session feeds into, the policy checks, and the shared model
 * types), and `tsconfig.build.json` sets an explicit `rootDir` so `npm run build`
 * actually produces `dist/index.js` at the package root — the file `package.json`'s
 * `"main"` field always claimed but never, in fact, built.
 *
 * `"principal-graph": "file:./stack/principal-graph"` in this range's own package.json
 * turns that into an ordinary node_modules symlink, so this is a single, normal import —
 * no relative path into the submodule's own build output, and (unlike before) nothing
 * here needs to know or care that Principal-Graph is a submodule at all. This file stays
 * the one place that import lives, purely so every other adapter has one name to import
 * from rather than repeating "principal-graph" everywhere.
 *
 * Requires `stack/principal-graph` to have been built first (`npm ci && npm run build`
 * inside that directory — see README's own "Build order" section, and
 * scripts/build-stack.mjs) so the symlinked package actually has a `dist/` to resolve
 * into.
 */
export {
  ensurePrincipal,
  ensureResource,
  type PrincipalSighting,
  type ResourceSighting,
  type Queryable,
  createPool,
  createPrincipalGraphAuditSink,
  type BrokerAuditSinkOptions,
  type PrincipalGraphAuditSink,
  type BrokerPrincipalIdentity,
  createAdcGraphSink,
  type AdcGraphSink,
  type AdcGraphEvent,
  type AdcPrincipalKind,
  type AdcPrincipalIdentity,
  type AdcResourceIdentity,
  evaluatePolicies,
  POLICIES,
  type PolicyRule,
  type PolicyViolation,
  type PrincipalKind,
  type ResourceKind,
  type Relation,
  type GrantEdge,
  type Decision,
} from "principal-graph";
