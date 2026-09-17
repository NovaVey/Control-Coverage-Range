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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// attenuated-delegation-chain declares its own npm workspaces (packages/*, services/*)
// and its root "build" script already fans out to every one of them
// (`npm run build --workspaces --if-present`) — plain `npm run build` there is enough.
// The other three are each a single package with their own plain "build": "tsc" (or
// "tsc -p tsconfig.build.json") script — same command works for all four.
const STACK_DIRS = [
  'stack/taint-tracked-tool-broker',
  'stack/attenuated-delegation-chain',
  'stack/principal-graph',
  'stack/relationship-based-authorization',
];

for (const dir of STACK_DIRS) {
  const full = `${REPO_ROOT}${dir}`;
  if (!existsSync(`${full}/package.json`)) {
    console.error(`${dir} has no package.json — submodule not checked out. Run: git submodule update --init --recursive`);
    process.exit(1);
  }
}

// Principal-Graph's own package.json now pins taint-tracked-tool-broker as a real git
// dependency (`"taint-tracked-tool-broker": "git+https://.../Taint-Tracked-Tool-Broker.git#<sha>"`)
// — this range's own stack/taint-tracked-tool-broker submodule pin is a SEPARATE,
// independently-recorded commit (.gitmodules + the superproject's own tree), and nothing
// before this check ever verified the two agree. They silently didn't, once: this range's
// own GAPS.md #34/taxonomy row on the subject predates Principal-Graph's own TTTB pin
// having moved past it. Failing loudly here, before either project's own build even
// starts, is what would have caught that the moment it happened, instead of a scenario
// quietly typechecking or running against a Broker feature Principal-Graph's own real
// exporter was never built against.
function assertTttbPinsAgree() {
  // Set by range.yml's "Override one submodule" step, workflow_call only —
  // absent for this repo's own direct push/pull_request/workflow_dispatch
  // triggers, where the premise below still holds. When
  // taint-tracked-tool-broker itself is the overridden submodule, this run
  // is deliberately testing a commit that's newer than (and hasn't yet been
  // pinned by) Principal-Graph's own dependency on it — exactly the
  // divergence this assertion exists to catch on an ordinary run, but here
  // it's the point: proving whether that commit is safe for Principal-Graph's
  // real exporter BEFORE either pin moves to it, not after.
  if (process.env.RANGE_OVERRIDE_REPO === 'taint-tracked-tool-broker') {
    console.log(
      'Skipping the stack/taint-tracked-tool-broker <-> stack/principal-graph pin-agreement check: ' +
        'this run overrides stack/taint-tracked-tool-broker itself to an unpinned-elsewhere commit.',
    );
    return;
  }
  const principalGraphPackageJson = JSON.parse(
    readFileSync(`${REPO_ROOT}stack/principal-graph/package.json`, 'utf8'),
  );
  const declared = principalGraphPackageJson.dependencies?.['taint-tracked-tool-broker'];
  if (!declared) {
    console.error(
      "stack/principal-graph/package.json no longer declares a taint-tracked-tool-broker dependency at all — this assertion (and this range's own reason for pinning a matching submodule commit) needs re-examining, not silently skipping.",
    );
    process.exit(1);
  }
  const match = /#([0-9a-f]{7,40})$/.exec(declared);
  if (!match) {
    console.error(
      `stack/principal-graph/package.json's own taint-tracked-tool-broker dependency ("${declared}") isn't a git+<url>#<sha> reference this check knows how to parse — update this assertion if that dependency's own shape has changed.`,
    );
    process.exit(1);
  }
  const principalGraphsPin = match[1];
  const thisRangesPin = execFileSync(
    'git',
    ['-C', `${REPO_ROOT}stack/taint-tracked-tool-broker`, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  ).trim();
  // A short sha in package.json (git dependency specs are sometimes written that way)
  // still has to be a real prefix of the full sha `git rev-parse` returns.
  if (!thisRangesPin.startsWith(principalGraphsPin)) {
    console.error(
      `taint-tracked-tool-broker submodule pin mismatch:\n` +
        `  stack/principal-graph/package.json depends on commit ${principalGraphsPin}\n` +
        `  this range's own stack/taint-tracked-tool-broker submodule is pinned to ${thisRangesPin}\n` +
        `These have to be the same commit — Principal-Graph's own real RBA exporter and this range's own scenarios both need to be built and typechecked against the identical Broker code, or this range is testing a pairing neither project actually ships. Repin stack/taint-tracked-tool-broker to ${principalGraphsPin} (or update Principal-Graph's own dependency, if that commit is the one that should move).`,
    );
    process.exit(1);
  }
  console.log(
    `✓ stack/taint-tracked-tool-broker (${thisRangesPin}) matches the commit stack/principal-graph/package.json itself depends on.`,
  );
}

assertTttbPinsAgree();

for (const dir of STACK_DIRS) {
  const full = `${REPO_ROOT}${dir}`;
  console.log(`\n=== ${dir}: npm ci ===`);
  execFileSync('npm', ['ci'], { cwd: full, stdio: 'inherit' });
  console.log(`=== ${dir}: npm run build ===`);
  execFileSync('npm', ['run', 'build'], { cwd: full, stdio: 'inherit' });
}

console.log('\nAll four sibling projects built.');
