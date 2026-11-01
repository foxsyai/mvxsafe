#!/usr/bin/env node
// OPZ-07: an ignored .env.production.local turns the "mainnet" build into a development build, and
// deploy.sh ships it under the commit's name.
//
// Vite reads .env, .env.production and .env.production.local from the project root at `vite build`
// and honours NODE_ENV from them. .gitignore ignores .env.local, .env.production.local and the other
// .env.*.local files. deploy.sh's gates (ops audit of 21 Oct 2026) look at `git status`, at ignored
// files under public/ and index.html, and at skip-worktree flags: none of them sees a .env file at
// the root. The build then compiles React, sdk-dapp and everything else in development mode (the
// bundle is 250 KB larger, carries the development warnings and lacks the production error
// decoder), while build/version.txt and the environment marker still name the commit and mainnet,
// so every check after the build passes and rsync uploads it.
//
// This runs the real deploy.sh in a throwaway clone (the 21 Oct harness: a local bare copy stands
// in for GitHub, the locked node_modules is linked, rsync/ssh/curl only record, the build is real).
// Its pnpm shim skips `pnpm install` (the tree is linked) and `pnpm audit` (its outcome is not what
// this proof tests, and it depends on the registry's advisories of the day); FAST=1 stubs the lint
// and the tests. Exit 1 when deploy.sh ships a development build (bug), 0 when it refuses (fixed).
//
//   FAST=1 node src/__audit__/nov01/ops/proofs/OPZ-07-deploy-env-file.mjs
//   DEPLOY_SH=/path/to/fixed/deploy.sh FAST=1 node ...   # expected: exit 0
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import {
  git,
  indent,
  makeRepo
} from '../../../oct21/ops/proofs/lib/deployHarness.mjs';

function runDeploy(work) {
  const shim = join(work, '..', 'shim');
  const log = join(work, '..', 'calls.log');
  mkdirSync(shim, { recursive: true });
  const realPnpm = execFileSync('sh', ['-c', 'command -v pnpm'], {
    encoding: 'utf8'
  }).trim();
  const shimOf = (name, body) => {
    writeFileSync(
      join(shim, name),
      `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`
    );
    chmodSync(join(shim, name), 0o755);
  };
  shimOf(
    'pnpm',
    `case "$1" in install) echo "(shim) pnpm install skipped: node_modules is the linked, locked tree"; exit 0;; audit) echo "(shim) pnpm audit skipped: not under test here"; exit 0;; esac\n` +
      `exec "${realPnpm}" "$@"`
  );
  shimOf('rsync', 'exit 0');
  shimOf('ssh', 'exit 0');
  shimOf(
    'curl',
    `case "$*" in *http_code*) printf 200;; *version.txt) cat "${join(work, 'build', 'version.txt')}";; esac\nexit 0`
  );
  if (process.env.FAST === '1')
    shimOf('npx', 'echo "(shim) npx $1 skipped (FAST=1)"; exit 0');
  const run = spawnSync('bash', ['deploy.sh', 'mainnet'], {
    cwd: work,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const output = run.stdout + run.stderr;
  return {
    status: run.status,
    said: output
      .split('\n')
      .filter((l) =>
        /^(REFUSING|Building|build\/|Shipping|Live:|The |\(shim\))/.test(l)
      ),
    shipped: /^rsync .*build\/ .*web@.*\/var\/www\//m.test(calls)
  };
}

const repo = makeRepo({ deployScript: process.env.DEPLOY_SH });
try {
  writeFileSync(
    join(repo.work, '.env.production.local'),
    'NODE_ENV=development\n'
  );
  const status = git(
    repo.work,
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    '.'
  );
  const ignored = git(
    repo.work,
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--',
    'public',
    'index.html'
  );
  console.log(
    `HEAD ${repo.head.slice(0, 7)} = origin/main; .env.production.local says NODE_ENV=development`
  );
  console.log(
    `  git status --porcelain --untracked-files=all -- . -> ${status ? JSON.stringify(status) : '(nothing)'}`
  );
  console.log(
    `  git ls-files --others --ignored --exclude-standard -- public index.html -> ${ignored || '(nothing)'}`
  );

  const r = runDeploy(repo.work);
  console.log(`\ndeploy.sh (mainnet) exit ${r.status}`);
  console.log('--- deploy.sh said:\n' + indent(r.said));
  const assets = join(repo.work, 'build', 'assets');
  const bundle = existsSync(assets)
    ? readdirSync(assets).find((f) => /^index-.*\.js$/.test(f))
    : null;
  let development = false;
  if (bundle) {
    const js = readFileSync(join(assets, bundle), 'utf8');
    // A production React carries the error decoder; a development React carries the full warnings.
    const prodMarker = js.includes('Minified React error');
    const devMarker = js.includes('Each child in a list should have a unique');
    development = !prodMarker && devMarker;
    console.log(
      `--- build/assets/${bundle}: ${js.length} bytes, production marker ${prodMarker}, development warnings ${devMarker}`
    );
    console.log(
      `--- build/version.txt: ${readFileSync(join(repo.work, 'build', 'version.txt'), 'utf8').trim()}`
    );
  }

  if (r.shipped && development) {
    console.log(
      '\nBUG (OPZ-07): deploy.sh shipped a development build of React and sdk-dapp as "mainnet" at the commit\'s name; no gate saw .env.production.local'
    );
    process.exit(1);
  }
  if (r.shipped) {
    console.log(
      '\nNOT REPRODUCED: the shipped bundle is a production build (Vite no longer reads NODE_ENV from .env files?)'
    );
    process.exit(0);
  }
  console.log(
    '\nOK: deploy.sh refused to ship with a .env file that git ignores'
  );
} finally {
  repo.cleanup();
}
