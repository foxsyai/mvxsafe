// RED-02 proof (redteam audit, 1 Nov 2026). Read-only: nothing is signed or
// sent. Two halves:
//
//   1. The chain. The app's own trial (POST /transaction/cost on the devnet
//      gateway, which checks no signature) runs the deployed multisig: the
//      rehearsal safe calls its own dnsRegister with 0.01 xEGLD and a wallet
//      as dns_address. The VM answers with a smart contract result that moves
//      the 0.01 xEGLD from the safe to that wallet ("register@<name>...",
//      operation transfer). That is the deployed bytecode's behaviour and
//      cannot change.
//   2. The app. The jest test RED-02.test.ts asks the sentence and the checks
//      a signer gets for that very action to say where the EGLD goes.
//
// Exits 1 while the chain forwards the EGLD AND the app does not say so (the
// bug reproduces); 0 once the app says so, or if the chain did not forward
// (then there is nothing to warn about). Exits 2 when the network did not
// answer.
//
//   node src/__audit__/nov01/redteam/proofs/RED-02.mjs
import { spawnSync } from 'node:child_process';
import { Address } from '@multiversx/sdk-core';

const GATEWAY = 'https://devnet-gateway.multiversx.com';
// The devnet rehearsal safe (docs/upgrade-and-calls.md), 2 of 3, owns itself.
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
// Any wallet: here the display fixtures' ALICE.
const WALLET = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const VALUE = 10n ** 16n; // 0.01 xEGLD

const data = `dnsRegister@${Address.newFromBech32(WALLET).toHex()}@${Buffer.from('zzzname').toString('hex')}`;
const body = {
  nonce: 0,
  value: VALUE.toString(),
  receiver: SAFE,
  sender: SAFE,
  gasPrice: 1000000000,
  gasLimit: 600000000,
  data: Buffer.from(data).toString('base64'),
  chainID: 'D',
  version: 1
};

let answer;
try {
  const response = await fetch(`${GATEWAY}/transaction/cost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  answer = await response.json();
} catch (error) {
  console.error('The gateway did not answer:', error?.message ?? error);
  process.exit(2);
}
if (!answer?.data) {
  console.error('Unexpected answer from the gateway:', JSON.stringify(answer));
  process.exit(2);
}
const results = Object.values(answer.data.smartContractResults ?? {});
const forwarded = results.find(
  (result) =>
    result.receiver === WALLET &&
    result.sender === SAFE &&
    BigInt(result.value ?? 0) === VALUE &&
    String(result.data ?? '').startsWith('register@')
);
console.log(
  `Chain: returnMessage="${answer.data.returnMessage}", ${results.length} smart contract result(s).`
);
if (!forwarded) {
  console.log(
    'The VM did not forward the EGLD to the dns_address: nothing to warn about.'
  );
  process.exit(0);
}
console.log(
  `The VM forwards ${VALUE} (0.01 xEGLD) from the safe to ${WALLET} as "${forwarded.data.slice(0, 24)}..." (operation ${forwarded.operation}).`
);

// The app's side: does the sentence a signer reads say so?
const jest = spawnSync(
  'npx',
  ['jest', 'src/__audit__/nov01/redteam/RED-02.test.ts', '--silent'],
  { cwd: new URL('../../../../..', import.meta.url).pathname, encoding: 'utf8' }
);
const appSaysSo = jest.status === 0;
console.log(
  appSaysSo
    ? 'App: the sentence and the checks name the destination of the EGLD.'
    : 'App: the sentence reads "on this safe itself, sending 0.01 EGLD with it", with no red check (RED-02.test.ts fails).'
);
process.exit(appSaysSo ? 0 : 1);
