#!/usr/bin/env node
// OPZ-07, what its proof does not pin. That proof stops at the widened gate, so
// nothing there shows the check after the build at work, a stray file outside
// public/, or that the gate still lets a normal deploy through:
//
//   1. NODE_ENV=development in the shell: no file to see, a real development
//      build. Must be refused after the build, with nothing shipped.
//   2. An ignored file at the root, outside public/ and not a .env file. Must
//      be refused at the gate, before any build.
//   3. Control: the generated files that are always there (node_modules, an old
//      build/, src/config/index.ts). Must ship, and the real production bundle
//      must pass the check of case 1.
//
// The real deploy.sh in a throwaway clone, as in the proof. The harness clones
// main, so on a branch name the script under test with DEPLOY_SH. Exit 1 while
// any case goes the wrong way. Two real builds.
//
//   DEPLOY_SH=$PWD/deploy.sh FAST=1 node src/__audit__/nov01/ops/proofs/OPZ-07-deploy-gates-controls.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  indent,
  makeRepo,
  runDeploy
} from '../../../oct21/ops/proofs/lib/deployHarness.mjs';

const refusals = (r) => r.said.filter((l) => l.startsWith('REFUSING'));
const built = (r) => r.said.some((l) => l.startsWith('Building'));

const cases = [
  {
    name: 'NODE_ENV=development in the shell',
    env: { NODE_ENV: 'development' },
    good: (r) =>
      !r.shipped &&
      built(r) &&
      refusals(r).some((l) => l.includes('development build'))
  },
  {
    name: 'an ignored notes.pem at the root',
    prepare: (work) => writeFileSync(join(work, 'notes.pem'), 'not a key\n'),
    good: (r) =>
      !r.shipped &&
      !built(r) &&
      refusals(r).some((l) => l.includes('files git ignores'))
  },
  {
    name: 'control: only the generated files',
    prepare: (work) => {
      mkdirSync(join(work, 'build'), { recursive: true });
      writeFileSync(join(work, 'build', 'old.txt'), 'a previous build\n');
      writeFileSync(join(work, 'src', 'config', 'index.ts'), '// generated\n');
    },
    good: (r) => r.shipped && r.status === 0
  }
];

let wrong = 0;
for (const { name, env, prepare, good } of cases) {
  const repo = makeRepo({ deployScript: process.env.DEPLOY_SH });
  try {
    prepare?.(repo.work);
    const r = runDeploy(repo.work, { env, skipAudit: true });
    const ok = good(r);
    if (!ok) wrong++;
    console.log(
      `${ok ? 'ok ' : 'BUG'} ${name}: exit ${r.status}, shipped ${r.shipped}`
    );
    console.log(indent(r.said.filter((l) => !l.startsWith('build/'))));
  } finally {
    repo.cleanup();
  }
}
if (wrong) {
  console.log(`\nBUG (OPZ-07): ${wrong} of ${cases.length} went the wrong way`);
  process.exit(1);
}
console.log('\nOK: both refused where they should be, the normal deploy ships');
