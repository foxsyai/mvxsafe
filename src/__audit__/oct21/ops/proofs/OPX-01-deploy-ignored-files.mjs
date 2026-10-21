#!/usr/bin/env node
// OPX-01: deploy.sh's clean-tree gate does not see files that .gitignore
// hides, and Vite copies all of public/ into the build, so a file that exists
// only on the deploying machine ships to the live site while the gate reports
// "what goes live is what is on GitHub".
//
// deploy.sh refuses "uncommitted changes" when
//   git status --porcelain --untracked-files=all -- .
// prints anything. That command never lists IGNORED files, and .gitignore
// ignores, at any depth (so inside public/ too): *.pem, *.mnemonic,
// .DS_Store, screenshots, videos, .cache, .env.local. The build then copies
// public/ as it is (Vite's copyPublicDir), the version check passes (the
// commit and the network are right), and rsync ships the stray file.
//
// This runs the real deploy.sh in a throwaway clone (see lib/deployHarness.mjs:
// a local bare copy stands in for GitHub, rsync/ssh only record, the build is
// real). Two ignored files are put under public/ first. Exit 1 when deploy.sh
// ships a build that contains them (bug), 0 when it refuses (fixed).
//
//   node src/__audit__/oct21/ops/proofs/OPX-01-deploy-ignored-files.mjs
//   FAST=1 node ...                      # stub the lint and the tests (a minute)
//   DEPLOY_SH=/path/to/fixed/deploy.sh node ...   # expected: exit 0
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, indent, makeRepo, runDeploy } from './lib/deployHarness.mjs';

const repo = makeRepo({ deployScript: process.env.DEPLOY_SH });
try {
  const stray = ['public/leaked.pem', 'public/screenshots/capture.png'];
  mkdirSync(join(repo.work, 'public/screenshots'), { recursive: true });
  writeFileSync(
    join(repo.work, stray[0]),
    'not a key: a placeholder that must never reach the site\n'
  );
  writeFileSync(join(repo.work, stray[1]), 'not a picture either\n');

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
    'public'
  );
  console.log(
    `HEAD ${repo.head.slice(0, 7)} = origin/main, tree clean to the gate:`
  );
  console.log(
    `  git status --porcelain --untracked-files=all -- . -> ${status ? JSON.stringify(status) : '(nothing)'}`
  );
  console.log(
    `  git ls-files --others --ignored --exclude-standard -- public -> ${ignored.split('\n').join(', ')}`
  );

  const r = runDeploy(repo.work);
  const inBuild = stray.filter((f) =>
    existsSync(join(repo.work, 'build', f.replace(/^public\//, '')))
  );
  console.log(`\ndeploy.sh (mainnet) exit ${r.status}`);
  console.log('--- deploy.sh said:\n' + indent(r.said));
  console.log(
    '--- commands recorded:\n' +
      indent(r.calls.filter((c) => !/^pnpm (-s )?(copy|build)/.test(c)))
  );
  console.log(
    `--- stray files in build/: ${inBuild.length ? inBuild.join(', ') : '(none)'}`
  );

  if (r.shipped && inBuild.length) {
    console.log(
      `\nBUG (OPX-01): deploy.sh shipped ${inBuild.join(' and ')} to the live site; the clean-tree gate did not see them because git ignores them`
    );
    process.exit(1);
  }
  if (r.shipped) {
    console.log(
      '\nNOT REPRODUCED: the build did not contain the stray files (Vite no longer copies them?)'
    );
    process.exit(0);
  }
  console.log(
    '\nOK: deploy.sh refused to ship with files git ignores under public/'
  );
} finally {
  repo.cleanup();
}
