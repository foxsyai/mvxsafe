#!/usr/bin/env node
// OPX-07: deploy.sh's clean-tree gate trusts `git status`, and git status
// says nothing about a tracked file whose index entry carries the
// skip-worktree (or assume-unchanged) bit. Such a file can differ from the
// commit, the gate passes, the version marker names the commit, and the site
// ships code that is not on GitHub.
//
// The bit is what people set to keep a local edit out of git for good ("git
// update-index --skip-worktree deploy.sh" to point at a test host, or a config
// tweak); tools set it too (sparse checkouts). Here index.html, the entry Vite
// builds from, gets a line that is not in the commit.
//
// This runs the real deploy.sh in a throwaway clone (see lib/deployHarness.mjs:
// a local bare copy stands in for GitHub, rsync/ssh only record, the build is
// real). Exit 1 when deploy.sh ships a build that carries the local edit (bug),
// 0 when it refuses (fixed).
//
//   node src/__audit__/oct21/ops/proofs/OPX-07-deploy-skip-worktree.mjs
//   FAST=1 node ...                      # stub the lint and the tests (a minute)
//   DEPLOY_SH=/path/to/fixed/deploy.sh node ...   # expected: exit 0
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, indent, makeRepo, runDeploy } from './lib/deployHarness.mjs';

const MARK = '<meta name="opx-07" content="this line is not on GitHub" />';
const repo = makeRepo({ deployScript: process.env.DEPLOY_SH });
try {
  const entry = join(repo.work, 'index.html');
  git(repo.work, 'update-index', '--skip-worktree', 'index.html');
  writeFileSync(
    entry,
    readFileSync(entry, 'utf8').replace('</head>', `    ${MARK}\n  </head>`)
  );

  const status = git(
    repo.work,
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    '.'
  );
  const diff = git(repo.work, 'diff', '--stat', 'HEAD', '--', 'index.html');
  const bits = git(repo.work, 'ls-files', '-v', '--', 'index.html');
  console.log(
    `HEAD ${repo.head.slice(0, 7)} = origin/main; index.html edited locally, flagged skip-worktree:`
  );
  console.log(
    `  git status --porcelain --untracked-files=all -- . -> ${status ? JSON.stringify(status) : '(nothing)'}`
  );
  console.log(`  git diff --stat HEAD -- index.html -> ${diff || '(nothing)'}`);
  console.log(`  git ls-files -v -- index.html -> ${bits}`);

  const r = runDeploy(repo.work);
  const built = join(repo.work, 'build', 'index.html');
  const carried =
    existsSync(built) && readFileSync(built, 'utf8').includes(MARK);
  console.log(`\ndeploy.sh (mainnet) exit ${r.status}`);
  console.log('--- deploy.sh said:\n' + indent(r.said));
  console.log(
    '--- commands recorded:\n' +
      indent(r.calls.filter((c) => !/^pnpm (-s )?(copy|build)/.test(c)))
  );
  console.log(
    `--- the local edit in build/index.html: ${carried ? 'yes' : 'no'}`
  );

  if (r.shipped && carried) {
    console.log(
      `\nBUG (OPX-07): deploy.sh shipped an index.html that is not the commit's, and version.txt names ${repo.head.slice(0, 7)} all the same`
    );
    process.exit(1);
  }
  if (r.shipped) {
    console.log('\nNOT REPRODUCED: the build did not carry the local edit');
    process.exit(0);
  }
  console.log(
    '\nOK: deploy.sh refused to ship a tree that differs from the commit'
  );
} finally {
  repo.cleanup();
}
