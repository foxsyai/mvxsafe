// SC-01 devnet proof (read-only; no key, no transaction, no value at risk).
//
// One pending action with a large call argument (~12 KB) makes the contract's
// getPendingActionFullInfo view fail with "storage decode error". That is the
// ONLY view mvxsafe's readPendingActions reads to list the pending actions, so
// the whole board loses sight of EVERY pending action (legit ones included) and
// can no longer sign, carry out or discard anything through mvxsafe.
//
// The devnet safe below was built with the SHIPPED Call-form builders:
//   action #1 = a normal 0.001 EGLD transfer (legitimate, mid-vote);
//   action #4 = a call with a ~12,000-byte hex argument (buildProposeCall, the
//               exact bytes mvxsafe's "Call a contract" form would send).
// A ~9,000-byte argument is still individually decodable; ~12,000 is not. The
// bulk list view dies as soon as one action crosses that boundary.
//
// This script reads that safe and shows:
//   - getPendingActionFullInfo  -> FAILS (user error: storage decode error)
//   - getActionData(#4) poison  -> FAILS (the one oversized action is undecodable)
//   - getActionData(#1) legit   -> OK    (legitimate actions ARE readable per id)
//   - getActionSigners / getActionValidSignerCount(#4) -> OK (so it can still be
//     unsigned + discarded by id with external tooling: recoverable, not fatal)
//
// Exit 1 while the bug reproduces (bulk view down while legit actions exist),
// 0 when it does not (e.g. the poison action was discarded).
const API = 'https://devnet-api.multiversx.com';
const SAFE = 'erd1qqqqqqqqqqqqqpgqvhmkludyju7m9acwpfchadgeux9h0xa2mg8s523mc5';
const LEGIT = 1;
const POISON = 4;
const u32hex = (n) => (n === 0 ? '' : n.toString(16).padStart(2, '0'));

const rawQuery = async (funcName, args = []) => {
  const resp = await (
    await fetch(`${API}/vm-values/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scAddress: SAFE, funcName, args })
    })
  ).json();
  const d = resp?.data?.data ?? resp?.data ?? resp;
  return {
    code: d?.returnCode,
    message: d?.returnMessage,
    n: (d?.returnData ?? []).length
  };
};

const run = async () => {
  console.log(`safe   ${SAFE}`);
  console.log(
    `legit action #${LEGIT}, poison action #${POISON} (~12 KB argument, built by the Call form)`
  );

  const last = await rawQuery('getActionLastIndex');
  const full = await rawQuery('getPendingActionFullInfo');
  const legit = await rawQuery('getActionData', [u32hex(LEGIT)]);
  const poison = await rawQuery('getActionData', [u32hex(POISON)]);
  const signers = await rawQuery('getActionSigners', [u32hex(POISON)]);
  const validCount = await rawQuery('getActionValidSignerCount', [
    u32hex(POISON)
  ]);

  console.log(
    `  getActionLastIndex                 -> ${JSON.stringify(last)}`
  );
  console.log(
    `  getPendingActionFullInfo (app uses)-> ${JSON.stringify(full)}`
  );
  console.log(
    `  getActionData(#${LEGIT}) legit        -> ${JSON.stringify(legit)}`
  );
  console.log(
    `  getActionData(#${POISON}) poison       -> ${JSON.stringify(poison)}`
  );
  console.log(
    `  getActionSigners(#${POISON})           -> ${JSON.stringify(signers)}`
  );
  console.log(
    `  getActionValidSignerCount(#${POISON})  -> ${JSON.stringify(validCount)}`
  );

  const bulkDown = full.code !== 'ok';
  const legitReadable = legit.code === 'ok';
  const poisonUndecodable = poison.code !== 'ok';
  const discardable = signers.code === 'ok' && validCount.code === 'ok';

  console.log('');
  if (bulkDown && legitReadable && poisonUndecodable) {
    console.log(
      'SC-01 REPRODUCED: one ~12 KB pending action makes getPendingActionFullInfo fail ' +
        `("${full.message}"), so mvxsafe shows NO pending actions, although a legitimate ` +
        `action (#${LEGIT}) is perfectly readable on its own. The board is locked out of the ` +
        `pending list. Recoverable only outside mvxsafe (unsign+discard by id is ` +
        `${discardable ? 'possible: the signer views still answer' : 'UNCERTAIN: signer views also fail'}).`
    );
    process.exit(1);
  }
  console.log(
    'SC-01 not reproducing now (bulk view readable, or the poison action is gone).'
  );
  process.exit(0);
};

run().catch((e) => {
  console.error(`SC-01 proof could not complete: ${e.message}`);
  process.exit(2);
});
