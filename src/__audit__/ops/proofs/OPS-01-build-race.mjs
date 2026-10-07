#!/usr/bin/env node
// OPS-01: the network of a build is decided by a race.
//
// package.json:  "build-mainnet": "tsc & npm run copy-mainnet-config & vite build"
//
// `&` starts the three commands concurrently. Nothing orders the copy of
// src/config/config.mainnet.ts over src/config/index.ts before vite reads
// index.ts, so whatever network the file held before the build (devnet after
// `pnpm start-devnet`, `pnpm build-devnet`, the Playwright suite or
// `./deploy.sh devnet`) can end up in the "mainnet" bundle, and deploy.sh ships
// ./build to https://mvxsafe.io without looking.
//
// This script builds in a throwaway git worktree, never in the shared copy:
//   part A: `pnpm build-mainnet` as deploy.sh runs it, index.ts left on devnet,
//           ROUNDS times (default 5), to measure the warm-machine outcome;
//   part B: the same command with npm taking NPM_DELAY seconds (default 1.5)
//           to start, which is what a cold cache or a busy laptop does.
// Exit 1 when any "mainnet" build contains another network, 0 otherwise. After
// the fix (`&&` instead of `&`, or a build that writes and checks its network)
// both parts come out mainnet whatever npm's start-up time; `FIXED=1` applies
// that patch in the throwaway worktree to show it.
//
//   node src/__audit__/ops/proofs/OPS-01-build-race.mjs
//   FIXED=1 node src/__audit__/ops/proofs/OPS-01-build-race.mjs   # expected: exit 0
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = '/home/sebastian/FOXSY/mvxsafe/app';
const ROUNDS = Number(process.env.ROUNDS || 5);
const DELAY = process.env.NPM_DELAY || '1.5';

const tmp = mkdtempSync(join(tmpdir(), 'mvxsafe-ops01-'));
const wt = join(tmp, 'worktree');
execFileSync('git', ['-C', APP, 'worktree', 'add', '--detach', wt, 'HEAD'], { stdio: 'pipe' });
symlinkSync(join(APP, 'node_modules'), join(wt, 'node_modules'));

// FIXED=1 applies the suggested fix inside the throwaway worktree (copy first,
// then typecheck, then build, each step gated on the previous one), so the
// script can show what the regression test looks like once package.json is fixed.
if (process.env.FIXED) {
  const pkgPath = join(wt, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const net of ['devnet', 'testnet', 'mainnet']) {
    pkg.scripts[`build-${net}`] = `npm run copy-${net}-config && tsc && vite build`;
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('FIXED=1: worktree package.json patched to "npm run copy-<net>-config && tsc && vite build"');
}

const networkOfBundle = () => {
  const assets = join(wt, 'build', 'assets');
  const js = readdirSync(assets).find((f) => /^index-.*\.js$/.test(f));
  const text = readFileSync(join(assets, js), 'utf8');
  const m = text.match(/environment=[A-Za-z0-9_$]+\.(mainnet|devnet|testnet)/);
  return m ? m[1] : 'unknown';
};
const networkOfConfig = () => {
  const text = readFileSync(join(wt, 'src/config/index.ts'), 'utf8');
  const m = text.match(/EnvironmentsEnum\.(mainnet|devnet|testnet)/);
  return m ? m[1] : 'unknown';
};
const setConfig = (net) =>
  copyFileSync(join(wt, 'src/config', `config.${net}.ts`), join(wt, 'src/config/index.ts'));
const build = (env = {}) =>
  spawnSync('pnpm', ['build-mainnet'], {
    cwd: wt,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wrong = [];
try {
  console.log(`worktree ${wt} at ${execFileSync('git', ['-C', wt, 'rev-parse', '--short', 'HEAD']).toString().trim()}`);
  console.log(`\nPart A: pnpm build-mainnet with src/config/index.ts on devnet, ${ROUNDS} rounds, warm machine`);
  for (let i = 1; i <= ROUNDS; i++) {
    setConfig('devnet');
    const started = Date.now();
    const r = build();
    const net = networkOfBundle();
    console.log(`  round ${i}: exit ${r.status} in ${((Date.now() - started) / 1000).toFixed(1)} s, bundle network = ${net}`);
    if (net !== 'mainnet') wrong.push(`part A round ${i}: ${net}`);
  }

  console.log(`\nPart B: same command, npm needs ${DELAY} s to start (cold cache / busy machine)`);
  const shim = join(tmp, 'shim');
  mkdirSync(shim);
  const realNpm = execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
  writeFileSync(join(shim, 'npm'), `#!/bin/sh\nsleep ${DELAY}\nexec ${realNpm} "$@"\n`);
  chmodSync(join(shim, 'npm'), 0o755);
  setConfig('devnet');
  const started = Date.now();
  const r = build({ PATH: `${shim}:${process.env.PATH}` });
  const net = networkOfBundle();
  await sleep(Number(DELAY) * 1000 + 1500); // let the orphaned copy land before looking at the file
  console.log(
    `  exit ${r.status} in ${((Date.now() - started) / 1000).toFixed(1)} s, bundle network = ${net}, ` +
      `src/config/index.ts after the build = ${networkOfConfig()}`
  );
  if (net !== 'mainnet') wrong.push(`part B (npm ${DELAY} s slower): ${net}`);
} finally {
  await sleep(500);
  execFileSync('git', ['-C', APP, 'worktree', 'remove', '--force', wt], { stdio: 'pipe' });
  rmSync(tmp, { recursive: true, force: true });
}

if (wrong.length) {
  console.log(`\nBUG (OPS-01): a "mainnet" build came out with another network: ${wrong.join('; ')}`);
  process.exit(1);
}
console.log('\nOK: every mainnet build contained the mainnet config');
