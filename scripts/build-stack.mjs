#!/usr/bin/env node
// Builds every sibling project this range consumes via direct dist import
// (taint-tracked-tool-broker, in-process, via src/adapters/tttb-lib.ts; @adc/*
// packages, in-process; Principal-Graph, via a single ordinary package import —
// see src/adapters/principal-graph-lib.ts) or whose own image build needs it
// (RBA, Dockerfile-built in docker-compose). Deliberately four separate
// `npm ci`/`npm run build` pairs, one per submodule's own independent
// package.json/lockfile — these are real, separately-versioned projects,
// not npm workspaces of this repo (see ARCHITECTURE.md's "Why git
// submodules, not workspaces" section).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// attenuated-delegation-chain declares its own npm workspaces (packages/*, services/*)
// and its root "build" script already fans out to every one of them
// (`npm run build --workspaces --if-present`) — plain `npm run build` there is enough.
// The other three are each a single package with their own plain "build": "tsc" (or
// "tsc -p tsconfig.build.json") script — same command works for all four.
const STACK_DIRS = [
  "stack/taint-tracked-tool-broker",
  "stack/attenuated-delegation-chain",
  "stack/principal-graph",
  "stack/relationship-based-authorization",
];

for (const dir of STACK_DIRS) {
  const full = `${REPO_ROOT}${dir}`;
  if (!existsSync(`${full}/package.json`)) {
    console.error(
      `${dir} has no package.json — submodule not checked out. Run: git submodule update --init --recursive`,
    );
    process.exit(1);
  }
}

// Reads a git+<url>#<sha> dependency pin from a package.json, checking each
// field name in `fields` in order (a dependency can move between
// `dependencies`/`devDependencies` across a sibling's own commits — see the
// taint-tracked-tool-broker entry below for why both are checked there).
// Returns the extracted sha (short or full — package.json pins aren't
// always the full 40 chars), or null if `depName` isn't declared in any of
// the given fields at all.
function readGitDepPin(packageJsonRelPath, depName, fields) {
  const pkg = JSON.parse(
    readFileSync(`${REPO_ROOT}${packageJsonRelPath}`, "utf8"),
  );
  let declared;
  for (const field of fields) {
    declared = pkg[field]?.[depName];
    if (declared) break;
  }
  if (!declared) return null;
  const match = /#([0-9a-f]{7,40})$/.exec(declared);
  if (!match) {
    console.error(
      `${packageJsonRelPath}'s own ${depName} dependency ("${declared}") isn't a git+<url>#<sha> reference this check knows how to parse — update this assertion if that dependency's own shape has changed.`,
    );
    process.exit(1);
  }
  return match[1];
}

// A short sha in package.json (git dependency specs are sometimes written
// that way) still has to be a real prefix of whichever side has the full
// sha — either side may be the shorter one, so check both directions.
function pinsAgree(a, b) {
  return a.startsWith(b) || b.startsWith(a);
}

// Generalizes what used to be a single TTTB<->Principal-Graph check into:
// any package more than one of this range's own siblings pins independently
// has to resolve to the exact same commit everywhere it's pinned, or this
// range is silently exercising a pairing no real deployment actually ships.
// They silently didn't agree, once, for exactly the taint-tracked-tool-broker
// case below: this range's own GAPS.md #34/taxonomy row on the subject
// predates Principal-Graph's own TTTB pin having moved past it. Failing
// loudly here, before any of the four sibling projects' own build even
// starts, is what would have caught that the moment it happened, instead of
// a scenario quietly typechecking or running against a Broker feature
// Principal-Graph's own real exporter was never built against.
const SHARED_PACKAGE_CHECKS = [
  {
    label: "taint-tracked-tool-broker",
    // The real pin here is this range's own git submodule commit, not a
    // package.json field — nothing in this range's own top-level
    // package.json depends on it directly; src/adapters/tttb-lib.ts imports
    // the submodule's own build output straight off disk.
    truthLabel: "this range's own stack/taint-tracked-tool-broker submodule",
    // Principal-Graph has always depended on taint-tracked-tool-broker —
    // this is the original, established check, not a newly-adopted one —
    // so either side going silent about it is itself the regression to
    // fail loudly on, not something to shrug off as "not adopted yet".
    optional: false,
    readTruth: () =>
      execFileSync(
        "git",
        [
          "-C",
          `${REPO_ROOT}stack/taint-tracked-tool-broker`,
          "rev-parse",
          "HEAD",
        ],
        { encoding: "utf8" },
      ).trim(),
    // When taint-tracked-tool-broker itself (or principal-graph, the one
    // consumer checked below) is the overridden submodule, this run is
    // deliberately testing a commit that's newer than (and hasn't yet been
    // pinned by) the other side — exactly the divergence this check exists
    // to catch on an ordinary run, but here it's the point.
    skipIfOverriding: ["taint-tracked-tool-broker", "principal-graph"],
    consumers: [
      {
        label: "stack/principal-graph/package.json",
        // Principal-Graph moved this from dependencies to devDependencies
        // once its production code no longer called into
        // taint-tracked-tool-broker at runtime (it only needs the real
        // package to build/typecheck against and to run its own test
        // suite, which constructs a real broker directly) — see
        // NovaVey/Principal-Graph#53. Either still pins an exact commit
        // Principal-Graph's own npm ci/build installs and compiles
        // against, which is the only thing this check actually cares
        // about — check both, dependencies first, so a future
        // re-introduction as a real runtime dependency is picked up the
        // same way.
        readPin: () =>
          readGitDepPin(
            "stack/principal-graph/package.json",
            "taint-tracked-tool-broker",
            ["dependencies", "devDependencies"],
          ),
      },
    ],
  },
  {
    label: "@novavey/contracts",
    // No submodule of its own — this range's own top-level package.json is
    // itself a consumer, same as every sibling's, so it's used as the
    // reference the others are checked against below. There's no more
    // "true" a pin among equals here the way the submodule commit is for
    // taint-tracked-tool-broker above; this range's own copy was picked
    // purely because it's simplest to read first.
    truthLabel: "this range's own top-level package.json",
    readTruth: () =>
      readGitDepPin("package.json", "@novavey/contracts", ["dependencies"]),
    // Unlike taint-tracked-tool-broker above, adoption of this package is
    // still spreading commit by commit across the four siblings — this
    // range's own currently-pinned stack/taint-tracked-tool-broker and
    // stack/principal-graph submodule commits both predate it entirely.
    // Nothing to compare isn't a regression the way an established
    // dependency going silent would be, so a consumer (or this range's own
    // copy) simply not declaring it yet is skipped, not failed — this
    // check only has teeth once at least two parties actually declare it.
    optional: true,
    // Both consumers checked below are submodules this range can override;
    // overriding either means this run is deliberately testing a commit
    // that may carry its own, not-yet-synced @novavey/contracts pin.
    skipIfOverriding: ["taint-tracked-tool-broker", "principal-graph"],
    consumers: [
      {
        label: "stack/taint-tracked-tool-broker/package.json",
        readPin: () =>
          readGitDepPin(
            "stack/taint-tracked-tool-broker/package.json",
            "@novavey/contracts",
            ["dependencies"],
          ),
      },
      {
        label: "stack/principal-graph/package.json",
        readPin: () =>
          readGitDepPin(
            "stack/principal-graph/package.json",
            "@novavey/contracts",
            ["dependencies"],
          ),
      },
    ],
  },
];

function assertSharedPackagePinsAgree() {
  let anyMismatch = false;
  for (const check of SHARED_PACKAGE_CHECKS) {
    if (check.skipIfOverriding.includes(process.env.RANGE_OVERRIDE_REPO)) {
      console.log(
        `Skipping the ${check.label} pin-agreement check: this run overrides ` +
          `${process.env.RANGE_OVERRIDE_REPO} to an unpinned-elsewhere commit.`,
      );
      continue;
    }
    const truth = check.readTruth();
    if (!truth) {
      if (check.optional) {
        console.log(
          `Skipping the ${check.label} pin-agreement check: ${check.truthLabel} doesn't declare it (yet) — nothing to compare consumers against.`,
        );
        continue;
      }
      console.error(
        `${check.truthLabel} no longer declares a ${check.label} dependency at all — this check (and this range's own reason for pinning a matching commit elsewhere) needs re-examining, not silently skipping.`,
      );
      anyMismatch = true;
      continue;
    }
    for (const consumer of check.consumers) {
      const pin = consumer.readPin();
      if (!pin) {
        if (check.optional) {
          console.log(
            `Skipping ${consumer.label}'s ${check.label} pin-agreement check: it doesn't declare this dependency (yet).`,
          );
          continue;
        }
        console.error(
          `${consumer.label} no longer declares a ${check.label} dependency at all — this check (and this range's own reason for expecting one) needs re-examining, not silently skipping.`,
        );
        anyMismatch = true;
        continue;
      }
      if (!pinsAgree(truth, pin)) {
        console.error(
          `${check.label} pin mismatch:\n` +
            `  ${check.truthLabel} is pinned to ${truth}\n` +
            `  ${consumer.label} depends on commit ${pin}\n` +
            `These have to be the same commit, or this range is building and testing a pairing no real deployment actually ships. Repin whichever side is stale to match the other.`,
        );
        anyMismatch = true;
        continue;
      }
      console.log(
        `✓ ${consumer.label}'s ${check.label} dependency (${pin}) matches ${check.truthLabel} (${truth}).`,
      );
    }
  }
  if (anyMismatch) process.exit(1);
}

assertSharedPackagePinsAgree();

for (const dir of STACK_DIRS) {
  const full = `${REPO_ROOT}${dir}`;
  console.log(`\n=== ${dir}: npm ci ===`);
  execFileSync("npm", ["ci"], { cwd: full, stdio: "inherit" });
  console.log(`=== ${dir}: npm run build ===`);
  execFileSync("npm", ["run", "build"], { cwd: full, stdio: "inherit" });
}

console.log("\nAll four sibling projects built.");
