// TXB-01, chain side, READ-ONLY: nothing is signed or sent. Devnet only.
//
// The app gives a perform whose call could not be tried as the safe (the safe
// holds no EGLD for the trial, or the API did not answer) a budget built on
// UNKNOWN_CALL_NEED. A call to the ESDT system contract needs about 50M where
// it runs, so that default budget runs out and the action is used up with all
// its signatures (devnet, 30 Oct 2026, transaction
// af776c4960514e2a776a77ce2b5219cc5249fe712665ae4c1da0212f8831e4bf: 26.5M,
// "not enough gas", action gone; 62M failed, 65M worked).
//
// This script measures the need again with the app's own measureCall, as the
// rehearsal safe, and compares the app's unmeasured default with the floor
// the chain showed. Exits 1 while the default is below that floor, 0 once it
// is not.
//
//   cd app && node src/__audit__/nov01/tx/proofs/TXB-01.mjs
import { ApiNetworkProvider } from '@multiversx/sdk-core';
import {
  CALLBACK_GAS,
  measureCall,
  performPlan,
  SAFE_OWN_GAS
} from '../../../../multisig/gas.js';

const API = 'https://devnet-api.multiversx.com';
const api = new ApiNetworkProvider(API, { clientName: 'mvxsafe-audit-read' });
// The safe that owns the devnet token TSAFED-e52b18 (3 of 4, shard 1, from a
// devnet rehearsal): the ESDT contract checks the owner even in a trial,
// so the trial has to be sent as the owner. And the ESDT system contract.
const SAFE = 'erd1qqqqqqqqqqqqqpgqdnp067vys85q2sqkj0lmpshcexdvyp82xezsuhtvx0';
const ESDT = 'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzllls8a5w6u';
// What the network locks for the safe's callback (measured 13 Oct 2026).
const CALLBACK_LOCK = 6458200n;
const hex = (text) => Buffer.from(text).toString('hex');

const safe = await fetch(`${API}/accounts/${SAFE}`).then((r) => r.json());
console.log(`safe ${SAFE} holds ${Number(safe.balance) / 1e18} xEGLD`);

const calls = {
  controlChanges: `controlChanges@${hex('TSAFED-e52b18')}@${hex('canUpgrade')}@${hex('false')}`,
  setSpecialRole: `setSpecialRole@${hex('TSAFED-e52b18')}@${'11'.repeat(32)}@${hex('ESDTRoleLocalMint')}`,
  pause: `pause@${hex('TSAFED-e52b18')}`
};
let measured = 0n;
for (const [name, data] of Object.entries(calls)) {
  try {
    const trial = await measureCall(api, {
      chainId: 'D',
      safe: SAFE,
      to: ESDT,
      egld: 0n,
      data
    });
    console.log(
      `  ${name}: ${trial.how}, need ${trial.need?.toLocaleString('en-US')}`
    );
    if (trial.need && trial.need > measured) measured = trial.need;
  } catch (error) {
    console.log(`  ${name}: refused (${error.message})`);
  }
}
if (measured === 0n) {
  console.log('The network could not measure any of them: no verdict.');
  process.exit(2);
}

const floor = SAFE_OWN_GAS + CALLBACK_LOCK + measured;
const unmeasured = performPlan({
  name: 'SendAsyncCall',
  callNeed: null,
  systemCall: true
});
const asMeasured = performPlan({ name: 'SendAsyncCall', callNeed: measured });
console.log(
  `measured need ${measured.toLocaleString('en-US')}; floor for a perform ${floor.toLocaleString('en-US')}`
);
console.log(
  `the app's budget with the trial: ${asMeasured.gasLimit.toLocaleString('en-US')}`
);
console.log(
  `the app's budget WITHOUT the trial (no EGLD in the safe, or the API down): ${unmeasured.gasLimit.toLocaleString('en-US')}`
);
if (unmeasured.gasLimit < floor) {
  console.log(
    `REPRODUCED: a safe that cannot be tried carries out a system-contract call with ${unmeasured.gasLimit.toLocaleString('en-US')} gas, below the ${floor.toLocaleString('en-US')} it needs; the vote fails and the action is used up. (CALLBACK_GAS in the app is ${CALLBACK_GAS.toLocaleString('en-US')}.)`
  );
  process.exit(1);
}
console.log('The unmeasured default covers a system-contract call.');
process.exit(0);
