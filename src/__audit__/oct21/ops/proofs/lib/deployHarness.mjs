// A harness that runs the real deploy.sh against a throwaway copy of this
// repository, so that nothing leaves the machine and the shared working copy
// is never touched:
//
//   - a local BARE clone stands in for GitHub: deploy.sh's `git fetch origin
//     main` and `merge-base --is-ancestor HEAD origin/main` run against it;
//   - a work clone of that bare copy is where deploy.sh runs, with the
//     repository's own node_modules linked in (the locked tree);
//   - `pnpm install` is a no-op (the tree is linked), every other pnpm call is
//     the real pnpm, so `pnpm build-<network>` really typechecks and builds;
//   - `rsync` and `ssh` only record their arguments; `curl` answers 200 and
//     serves the version.txt of the build that was "shipped";
//   - the lint and the tests (`npx eslint`, `npx jest`) run for real unless
//     FAST=1 stubs `npx`: they take a minute and never bear on these proofs.
//
// DEPLOY_SH=<path> replaces deploy.sh in the throwaway copy (committed there,
// so the tree stays clean) to show the pass-after-fix behaviour of a proof.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repository root, six levels above this file.
export const APP = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
).replace(/\/$/, '');

export const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

/**
 * A throwaway copy of the repository: `origin.git` (bare, the stand-in for
 * GitHub) and `work` (checked out at origin/main, detached, clean).
 *
 * `deployScript`: a deploy.sh to test instead of the committed one; it is
 * committed in the copy and pushed to the local origin, so HEAD stays on
 * origin/main and the tree stays clean.
 * `aheadOfOrigin`: how many commits the local origin's main is pushed AHEAD
 * of the checked-out HEAD (the state of a laptop that did not pull).
 */
export function makeRepo({ deployScript, aheadOfOrigin = 0 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'mvxsafe-opx-'));
  const origin = join(tmp, 'origin.git');
  const work = join(tmp, 'work');
  execFileSync('git', ['clone', '-q', '--bare', '--no-hardlinks', APP, origin]);
  execFileSync('git', ['clone', '-q', origin, work]);
  git(work, 'config', 'user.email', 'proof@example.invalid');
  git(work, 'config', 'user.name', 'proof');
  git(work, 'checkout', '-q', '--detach', 'origin/main');
  symlinkSync(join(APP, 'node_modules'), join(work, 'node_modules'));
  if (deployScript) {
    copyFileSync(deployScript, join(work, 'deploy.sh'));
    chmodSync(join(work, 'deploy.sh'), 0o755);
    if (git(work, 'status', '--porcelain', '--', 'deploy.sh')) {
      git(work, 'commit', '-q', '-am', 'deploy.sh under test');
      git(work, 'push', '-q', 'origin', 'HEAD:main');
    }
  }
  const head = git(work, 'rev-parse', 'HEAD');
  for (let i = 1; i <= aheadOfOrigin; i++) {
    writeFileSync(join(work, `later-${i}.txt`), `a later commit, ${i}\n`);
    git(work, 'add', `later-${i}.txt`);
    git(work, 'commit', '-q', '-m', `a later commit on main, ${i}`);
  }
  if (aheadOfOrigin) {
    git(work, 'push', '-q', 'origin', 'HEAD:main');
    git(work, 'checkout', '-q', '--detach', head);
  }
  git(work, 'fetch', '-q', 'origin', 'main');
  return {
    tmp,
    origin,
    work,
    head,
    cleanup: () => rmSync(tmp, { recursive: true, force: true })
  };
}

/** Runs `bash deploy.sh <network>` in `work` with the shims on PATH. */
export function runDeploy(work, { network = 'mainnet' } = {}) {
  const shim = join(work, '..', 'shim');
  const log = join(work, '..', 'calls.log');
  mkdirSync(shim, { recursive: true });
  // Resolved before the shim directory is on PATH, so it is the real one.
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
    `case "$1" in install) echo "(shim) pnpm install skipped: node_modules is the linked, locked tree"; exit 0;; esac\n` +
      `exec "${realPnpm}" "$@"`
  );
  shimOf('rsync', 'exit 0');
  shimOf('ssh', 'exit 0');
  shimOf(
    'curl',
    `case "$*" in *http_code*) printf 200;; *version.txt) cat "${join(work, 'build', 'version.txt')}";; esac\nexit 0`
  );
  if (process.env.FAST === '1') {
    shimOf('npx', 'echo "(shim) npx $1 skipped (FAST=1)"; exit 0');
  }
  const run = spawnSync('bash', ['deploy.sh', network], {
    cwd: work,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const output = run.stdout + run.stderr;
  return {
    status: run.status,
    output,
    // deploy.sh's own lines, without the tool chatter in between.
    said: output
      .split('\n')
      .filter((l) =>
        /^(REFUSING|Building|build\/|Shipping|Live:|The |https?:\/\/|\(shim\))/.test(
          l
        )
      ),
    calls: calls.trim().split('\n').filter(Boolean),
    shipped: /^rsync .*build\/ .*web@.*\/var\/www\//m.test(calls)
  };
}

export const indent = (lines) => lines.map((l) => '  ' + l).join('\n');
