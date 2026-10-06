# mvxsafe

A multisig interface for MultiversX, at [mvxsafe.io](https://mvxsafe.io). It operates the
standard MultiversX multisig smart contract: read a safe, propose actions, sign them and carry
them out once the quorum is reached.

Built because xsafe.io stopped working and the Foxsy AI Foundation needs its own way in.

## What it is, and what it is not

- **No backend and no database.** The browser reads the public MultiversX API directly.
- **No custody.** Keys stay in your wallet. The app builds transactions, your wallet signs them.
- **Saved safes live in your browser.** The Foundation's seven are compiled in; anything you add
  is kept in local storage and goes nowhere else.
- **No analytics and no third party scripts.** The content policy on the server allows the
  MultiversX API and the WalletConnect relays, nothing else.

## State

Read-only: balances, board members, quorum, pending actions with signature counts, and history.
Proposing and signing come next, developed against a devnet test safe.

## The contracts

The Foundation's safes run the **plain** multisig build, which has no groups and no batches:
`getNumGroups` does not exist on them. The UI must never offer `proposeBatch`, `signBatch`,
`performBatch` or `discardBatch`. Verified read-only on 6 October 2026 against all seven, which
share one code hash and are quorum 2 of 3 with three board members and no proposers.

`src/abi/multisig-full.abi.json` is the ABI from `mx-sdk-js-core` testdata. It carries more
endpoints than our contracts have, which is harmless as long as the rule above holds.

## Running it

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm start-mainnet      # https://localhost:3000, reads mainnet
pnpm start-devnet       # against devnet
pnpm build-mainnet      # static build into ./build
```

The network is chosen at build time: each `copy-*-config` script copies
`src/config/config.<network>.ts` over `src/config/index.ts`.

## Deploying

```bash
./deploy.sh             # builds mainnet and rsyncs ./build to the droplet
```

Static, served by nginx on the websites droplet (`web@134.209.228.52`) from
`/var/www/mvxsafe.io`, with a Let's Encrypt certificate that renews itself. The vhost is
`/etc/nginx/sites-available/mvxsafe.io` and sets HSTS, `X-Frame-Options: DENY` and a content
policy allowing only the MultiversX API and gateway (mainnet and devnet) plus the WalletConnect
relays. **If the app ever needs a new host, that policy must allow it or the browser blocks the
call.** Nine other sites share that nginx; a backup from before this site existed is at
`/root/nginx-backup-20261006.tgz`.

## Built on

[mx-template-dapp](https://github.com/multiversx/mx-template-dapp) (official, current) plus the
multisig layer in `@multiversx/sdk-core`. The older
[mx-multisig-dapp](https://github.com/multiversx/mx-multisig-dapp) was rejected as a base: last
commit April 2022, WalletConnect v1 which was switched off in 2023, deprecated dependencies and
two imports that were never published. The template's own README is kept at
`docs/template-README.md`.

Pin `@multiversx/sdk-core` to 15.x: `sdk-dapp` 5.7 does not accept 16, and the multisig API is
identical in both.

## Licence

GPL-3.0-or-later, inherited from the template.
