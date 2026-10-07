#!/usr/bin/env node
// OPS-03: deploy.sh ships ./build to the mainnet host without checking which
// network the bundle was built for.
//
// deploy.sh runs `pnpm build-$NETWORK` and then `rsync -a --delete build/ ...`.
// Between the two there is no look at what the build produced. With OPS-01
// (the copy of the network config races the build) a devnet bundle can sit in
// ./build after `pnpm build-mainnet`, and the script would put it on
// https://mvxsafe.io; the only check afterwards is that the site answers 200,
// which a devnet build does.
//
// This runs the real deploy.sh with shims on PATH, so nothing leaves the
// machine: `pnpm` drops a devnet bundle into ./build (what the race, or a
// forgotten `pnpm build-devnet`, leaves there), `rsync` and `ssh` only record
// that they were called, `curl` answers 200. Exit 1 when deploy.sh calls rsync
// for the mainnet host with a bundle that is not a mainnet build (bug), 0 when
// it refuses (fixed).
//
//   node src/__audit__/ops/proofs/OPS-03-deploy-unverified.mjs
//   DEPLOY_SH=/path/to/fixed/deploy.sh node src/__audit__/ops/proofs/OPS-03-deploy-unverified.mjs   # expected: exit 0
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = '/home/sebastian/FOXSY/mvxsafe/app';
const tmp = mkdtempSync(join(tmpdir(), 'mvxsafe-ops03-'));
const log = join(tmp, 'calls.log');

// DEPLOY_SH=<path> runs another copy of the script, e.g. one with the fix, to
// show the pass-after-fix behaviour.
copyFileSync(process.env.DEPLOY_SH || join(APP, 'deploy.sh'), join(tmp, 'deploy.sh'));
chmodSync(join(tmp, 'deploy.sh'), 0o755);

// The bundle a devnet build leaves behind, with the same markers the real one
// carries (see src/config/config.devnet.ts and src/multisig/network.ts).
mkdirSync(join(tmp, 'devnet-build/assets'), { recursive: true });
writeFileSync(
  join(tmp, 'devnet-build/index.html'),
  '<!doctype html><script type="module" crossorigin src="/assets/index-DEVNET00.js"></script>'
);
writeFileSync(
  join(tmp, 'devnet-build/assets/index-DEVNET00.js'),
  'const API_URL=`https://devnet-template-api.multiversx.com`,environment=t$27.devnet,' +
    'API_BY_NETWORK={mainnet:`https://api.multiversx.com`,devnet:`https://devnet-api.multiversx.com`};\n'
);

const shim = join(tmp, 'shim');
mkdirSync(shim);
const shimOf = (name, body) => {
  writeFileSync(join(shim, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
  chmodSync(join(shim, name), 0o755);
};
shimOf('pnpm', `rm -rf build && cp -r "${join(tmp, 'devnet-build')}" build`);
shimOf('rsync', 'exit 0');
shimOf('ssh', 'exit 0');
shimOf('curl', 'printf 200');

const run = spawnSync('bash', ['deploy.sh'], {
  cwd: tmp,
  env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  encoding: 'utf8'
});
const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
rmSync(tmp, { recursive: true, force: true });

console.log(`deploy.sh (mainnet) exit ${run.status}`);
console.log('--- deploy.sh output:\n' + (run.stdout + run.stderr).trim().split('\n').map((l) => '  ' + l).join('\n'));
console.log('--- commands it ran:\n' + calls.trim().split('\n').map((l) => '  ' + l).join('\n'));

const shipped = /^rsync .*build\/ .*web@.*\/var\/www\/mvxsafe\.io\/?$/m.test(calls);
if (shipped) {
  console.log('\nBUG (OPS-03): deploy.sh shipped a devnet bundle to /var/www/mvxsafe.io without checking its network');
  process.exit(1);
}
console.log('\nOK: deploy.sh refused to ship a bundle that is not a mainnet build');
