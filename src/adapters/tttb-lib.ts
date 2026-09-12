/**
 * taint-tracked-tool-broker consumed via git submodule, not the npm registry —
 * two confirmed, real reasons, not a style preference (see
 * taxonomy/gaps/tttb.yaml's principal-feature-unreleased-at-pin-time row for
 * the full account):
 *
 *  1. This range's broker adapter needs BrokerOptions.principal/
 *     TaintContext.principal (GAPS.md #34's own identity axis) to close
 *     gap-34-identity-blind-policy — and `npm view
 *     taint-tracked-tool-broker@1.4.0 gitHead` resolves to a commit that
 *     predates that field entirely, even though the published version
 *     string ("1.4.0") is identical to what's in the git repository's
 *     current main branch. Depending on the npm-published range would
 *     silently build against different code than this adapter was actually
 *     written and typechecked against.
 *  2. Once that forced a git reference, a plain `"github:...#<sha>"` npm
 *     dependency turned out not to work at all: npm's git-install path
 *     only runs a package's own `prepare` lifecycle script (TTTB defines
 *     `prepack`, for `npm pack`/publish, not `prepare`), AND still applies
 *     package.json's own `files` allowlist when placing a git dependency
 *     into node_modules — that allowlist is `["dist", "docs", "examples",
 *     "conformance", ...]`, so a raw git checkout (no `dist/` built yet)
 *     ends up with no `src/` either: nothing buildable ever reaches
 *     node_modules at all. Confirmed directly (a real `npm install` left
 *     node_modules/taint-tracked-tool-broker with no `src/` directory),
 *     not inferred. A git submodule sidesteps both problems the same way
 *     it already does for Principal-Graph/RBA/ADC: a real, full clone,
 *     built explicitly (scripts/build-stack.mjs), imported from its own
 *     dist/ by relative path.
 */
export {
  createBroker,
  defaultPolicy,
  ToolCallBlockedError,
  UnknownToolError,
  ReentrantCallError,
  NonCloneableArgsError,
  type ToolCallBroker,
  type ToolExecutor,
  type PolicyFn,
  type PolicyDecision,
  type AuditEvent,
  type AuditSink,
  type SinkCapability,
  type ToolCall,
  type TaintContext,
  type BrokerOptions,
} from "../../stack/taint-tracked-tool-broker/dist/index.js";
