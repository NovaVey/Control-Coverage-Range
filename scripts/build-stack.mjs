#!/usr/bin/env node
// Builds every sibling project this range consumes via direct dist import
// (taint-tracked-tool-broker, in-process, via src/adapters/tttb-lib.ts —
// see taxonomy/gaps/tttb.yaml's principal-feature-unreleased-at-pin-time row
// for why this one is a submodule and not a plain npm dependency; @adc/*
// packages, in-process; Principal-Graph, for its
// upsert/audit-sink/policies/adc-graph-sink modules — see
// src/adapters/principal-graph-lib.ts) or whose own image build needs it
// (RBA, Dockerfile-built in docker-compose). Deliberately four separate
// `npm ci`/`npm run build` pairs, one per submodule's own independent
// package.json/lockfile — these are real, separately-versioned projects,
// not npm workspaces of this repo (see ARCHITECTURE.md's "Why git
// submodules, not workspaces" section).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

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
  console.log(`\n=== ${dir}: npm ci ===`);
  execFileSync('npm', ['ci'], { cwd: full, stdio: 'inherit' });
  console.log(`=== ${dir}: npm run build ===`);
  execFileSync('npm', ['run', 'build'], { cwd: full, stdio: 'inherit' });
}

console.log('\nAll three sibling projects built.');
