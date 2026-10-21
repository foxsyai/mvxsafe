#!/usr/bin/env node
// OPX-02: deploy.sh accepts ANY commit that origin/main contains, not the tip
// of origin/main, so a checkout that was not pulled after a merge on GitHub
// ships an older version of the site, and the gate calls it good.
//
// The gate is `git merge-base --is-ancestor HEAD origin/main`. Every earlier
// commit of main satisfies it: the previous release, or the tip of a branch
// whose pull request was merged (its tree lacks whatever other pull requests
// brought in since). Pull requests are merged on GitHub, so the laptop's main
// is behind origin/main right after every merge; `./deploy.sh` then rolls the
// site back to what the laptop has and prints only the short commit.
//
// This runs the real deploy.sh in a throwaway clone (see lib/deployHarness.mjs)
// whose local origin's main is one commit ahead of the clean, checked-out HEAD.
// Exit 1 when deploy.sh ships that older commit (bug), 0 when it refuses or
// asks for an explicit override (fixed).
//
//   node src/__audit__/oct21/ops/proofs/OPX-02-deploy-stale-commit.mjs
//   FAST=1 node ...                      # stub the lint and the tests (a minute)
//   DEPLOY_SH=/path/to/fixed/deploy.sh node ...   # expected: exit 0
import { git, indent, makeRepo, runDeploy } from './lib/deployHarness.mjs';

const repo = makeRepo({
  deployScript: process.env.DEPLOY_SH,
  aheadOfOrigin: 1
});
try {
  const head = git(repo.work, 'rev-parse', '--short', 'HEAD');
  const tip = git(repo.work, 'rev-parse', '--short', 'origin/main');
  const behind = git(repo.work, 'rev-list', '--count', 'HEAD..origin/main');
  console.log(
    `HEAD ${head} is ${behind} commit behind origin/main ${tip}; the tree is clean`
  );

  const r = runDeploy(repo.work);
  console.log(`\ndeploy.sh (mainnet) exit ${r.status}`);
  console.log('--- deploy.sh said:\n' + indent(r.said));
  console.log(
    '--- commands recorded:\n' +
      indent(r.calls.filter((c) => !/^pnpm (-s )?(copy|build)/.test(c)))
  );

  if (r.shipped) {
    console.log(
      `\nBUG (OPX-02): deploy.sh shipped ${head}, which is behind origin/main (${tip}), without a word about it`
    );
    process.exit(1);
  }
  console.log(
    '\nOK: deploy.sh refused to ship a commit that is not the tip of origin/main'
  );
} finally {
  repo.cleanup();
}
