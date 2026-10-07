# mvxsafe

A multisig interface for MultiversX, at [mvxsafe.io](https://mvxsafe.io). It operates the
standard MultiversX multisig smart contract: read a safe, propose actions, sign them and carry
them out once the quorum is reached.

Built after xsafe.io stopped working, so that the owners of these safes keep a way in.

## What it is, and what it is not

- **No backend and no database.** The browser reads the public MultiversX API directly.
- **No custody.** Keys stay in your wallet. The app builds transactions, your wallet signs them.
- **Addresses can carry names.** Yours, typed with the pencil, or the account's herotag, which
  the chain already knows. Names live in the browser and travel in the export file, because they
  are the only thing in this app a person authors.
- **Saved safes live in your browser.** Nothing is preloaded: anything you add
  is kept in local storage and goes nowhere else.
- **No analytics and no third party scripts.** The content policy on the server allows the
  MultiversX API and the WalletConnect relays, nothing else.

## State

Reading and acting. Connect a wallet and, on a safe whose board you sit on, you can propose
(tokens, EGLD, add or remove a member, change the quorum), sign, remove your signature, carry
an action out once the quorum is reached, and discard one. The whole cycle is proven on devnet
by `scripts/devnet/cycle.mjs`, which uses the same builders the app ships.

A new safe can be created from the interface too: the wallet signs the deployment and then a
second transaction that hands the safe to itself. The guide at /guide walks through all of it
with pictures of the live site, taken by `scripts/capture/guide.mjs`.

## The contracts, and why the SDK's multisig helper is not used

Most multisigs deployed before 2025 run an **older multisig build**.
Read out of the deployed bytecode, its endpoints are: `deposit`, `sign`, `unsign`,
`performAction`, `discardAction`, `proposeAddBoardMember`, `proposeAddProposer`,
`proposeRemoveUser`, `proposeChangeQuorum`, `proposeTransferExecute`, `proposeAsyncCall`,
`proposeSCDeployFromSource`, `proposeSCUpgradeFromSource`, plus views. There is **no**
`proposeTransferExecuteEsdt`, and there are no groups or batches.

That has three consequences, each found the hard way on devnet against a copy of their exact
bytecode (6 October 2026):

1. **`MultisigController` from the SDK builds for a newer contract.** Its propose calls carry an
   extra gas argument, which shifts everything along: a token transfer ends up with an empty
   endpoint name and `ESDTTransfer` sitting in the argument list. The proposal is accepted and
   then fails at perform, after signatures have been collected. We build the transactions
   ourselves in `src/multisig/legacyCalls.js`.
2. **The SDK's multisig ABI cannot decode a pending action here** and throws while reading one.
   `src/abi/multisig-legacy.abi.json` is written by hand to match the deployed contract.
3. **Tokens leave the safe as an async call** that spells out `ESDTTransfer`, the token and the
   amount. There is no ESDT-specific endpoint to use.

Both the app and the devnet test import the same builders, so what is proven is what ships.

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
./deploy.sh             # mainnet -> https://mvxsafe.io
./deploy.sh devnet      # devnet  -> https://devnet.mvxsafe.io
```

**https://devnet.mvxsafe.io** is the same app built against the MultiversX devnet, so the whole
cycle can be tried with play money before anything touches a real safe. It carries `noindex` so
it is never mistaken for the live site in search results. Its test safe and the throwaway keys
behind it are described in `scripts/devnet/`.

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
