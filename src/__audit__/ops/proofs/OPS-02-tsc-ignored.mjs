#!/usr/bin/env node
// OPS-02: the typecheck in the build scripts is decorative.
//
// package.json:  "build-mainnet": "tsc & npm run copy-mainnet-config & vite build"
//
// `tsc &` runs in the background; the script's exit status is vite's alone, so
// `pnpm build-mainnet` succeeds on code that does not typecheck, and deploy.sh
// (`set -e`, then `pnpm build-$NETWORK`, then rsync) ships it. vite does not
// typecheck. CI runs `npx tsc --noEmit` as its own step and would go red, but CI
// does not deploy; the laptop does.
//
// Builds in a throwaway git worktree with one injected type error. Exit 1 when
// the build succeeds anyway (bug), 0 when it fails (fixed: `&&`, or a separate
// typecheck step in deploy.sh). Exit 2 if the injected error is not even seen
// by tsc, which would make the run meaningless.
//
//   node src/__audit__/ops/proofs/OPS-02-tsc-ignored.mjs
//   FIXED=1 node src/__audit__/ops/proofs/OPS-02-tsc-ignored.mjs   # expected: exit 0
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = '/home/sebastian/FOXSY/mvxsafe/app';
const tmp = mkdtempSync(join(tmpdir(), 'mvxsafe-ops02-'));
const wt = join(tmp, 'worktree');
execFileSync('git', ['-C', APP, 'worktree', 'add', '--detach', wt, 'HEAD'], { stdio: 'pipe' });
symlinkSync(join(APP, 'node_modules'), join(wt, 'node_modules'));

// FIXED=1 applies the suggested fix (`&&`) inside the throwaway worktree.
if (process.env.FIXED) {
  const pkgPath = join(wt, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const net of ['devnet', 'testnet', 'mainnet']) {
    pkg.scripts[`build-${net}`] = `npm run copy-${net}-config && tsc && vite build`;
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('FIXED=1: worktree package.json patched to "npm run copy-<net>-config && tsc && vite build"');
}

let tscStatus;
let buildStatus;
try {
  copyFileSync(join(wt, 'src/config/config.mainnet.ts'), join(wt, 'src/config/index.ts'));
  writeFileSync(join(wt, 'src/__ops02_type_error.ts'), 'export const n: number = "not a number";\n');

  const tsc = spawnSync('npx', ['tsc', '--noEmit'], { cwd: wt, encoding: 'utf8' });
  tscStatus = tsc.status;
  console.log(`npx tsc --noEmit        -> exit ${tscStatus}`);
  console.log('  ' + (tsc.stdout.trim().split('\n').find((l) => l.includes('__ops02_type_error')) || '(no diagnostic)'));

  const build = spawnSync('pnpm', ['build-mainnet'], { cwd: wt, encoding: 'utf8' });
  buildStatus = build.status;
  console.log(`pnpm build-mainnet      -> exit ${buildStatus}`);
  console.log('  ' + (build.stdout.match(/built in [0-9.]+ ?m?s/) || ['(vite did not report a build)'])[0]);
  await new Promise((r) => setTimeout(r, 4000)); // let the background tsc finish before the worktree goes
} finally {
  execFileSync('git', ['-C', APP, 'worktree', 'remove', '--force', wt], { stdio: 'pipe' });
  rmSync(tmp, { recursive: true, force: true });
}

if (tscStatus === 0) {
  console.log('the injected type error was not detected; this run proves nothing');
  process.exit(2);
}
if (buildStatus === 0) {
  console.log('\nBUG (OPS-02): pnpm build-mainnet exits 0 although the typecheck fails; deploy.sh would ship it');
  process.exit(1);
}
console.log('\nOK: the build fails when the typecheck fails');
