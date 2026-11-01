# Security

mvxsafe is the interface through which real multisig safes approve and move their funds, so a
vulnerability report matters more than anything else here.

## Reporting

Please report privately, never in a public issue: use **Report a
vulnerability** on this repository's Security tab (GitHub's private
vulnerability reporting). Include what an attacker can do and the steps or a
test that shows it. We answer within a few days and credit you if you wish.

## What is in scope

- The site in this repository, served at https://mvxsafe.io and https://devnet.mvxsafe.io. A
  sentence on a card that misleads a signer about what they approve counts.
- The multisig contract file it deploys from, `public/contracts/multisig.wasm`.
- The build and deploy tooling: `deploy.sh`, `scripts/` and `.github/`.

## What has been reviewed

Adversarial audits run with an AI model, not by an outside firm. The proofs of the findings in this
repository's code are the tests and scripts in `src/__audit__/`. None of this is a promise that no
bug remains.

The live site names its commit in `/version.txt`: a clean build of that commit with
`pnpm install --frozen-lockfile` and `pnpm build-mainnet` gives the same files, which anyone can
compare.
