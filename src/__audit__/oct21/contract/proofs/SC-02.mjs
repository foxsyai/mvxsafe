// SC-02 devnet proof (read-only; no key, no transaction, no value at risk).
//
// The legacy multisig (the exact mainnet bytecode) ACCEPTS a quorum of 0. On the
// devnet safe below, changeQuorum(0) was proposed and performed with the SHIPPED
// builders (propose f747cfc4abd51f6dfbf499fd01a5d09b35e01c0401c3a1f1d28ffbefe275ee9c,
// perform d20336071254a7d6e9ce9417763534bfebd5ca24c1b318348f58ca76aaf9f083). The
// contract's only quorum guard is new_quorum <= board size ("quorum cannot exceed
// board size", confirmed on the same safe); there is NO new_quorum >= 1 guard.
//
// This reads the resulting state and shows the consequence the app does not warn about:
//   - getQuorum == 0  (mvxsafe renders this as "unknown"), and
//   - quorumReached(any action) == true, so every action is performable with no
//     signatures by any single board member or proposer.
//
// Exit 1 while the dangerous state is live (getQuorum == 0), 0 otherwise.
const API = 'https://devnet-api.multiversx.com';
const SAFE = 'erd1qqqqqqqqqqqqqpgqvhmkludyju7m9acwpfchadgeux9h0xa2mg8s523mc5';
const LEGIT = 1;
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
  return { code: d?.returnCode, data: d?.returnData ?? [] };
};
const asInt = (parts) =>
  parts[0]
    ? BigInt('0x' + Buffer.from(parts[0], 'base64').toString('hex'))
    : 0n;

const run = async () => {
  console.log(`safe ${SAFE}`);
  const q = await rawQuery('getQuorum');
  const quorum = asInt(q.data);
  console.log(
    `  getQuorum -> returnData ${JSON.stringify(q.data)} => ${quorum}`
  );
  const reached = await rawQuery('quorumReached', [u32hex(LEGIT)]);
  console.log(
    `  quorumReached(#${LEGIT}) -> ${JSON.stringify(reached)} (01 / non-empty = true)`
  );

  if (quorum === 0n) {
    console.log('');
    console.log(
      'SC-02 REPRODUCED: the mainnet multisig bytecode accepts getQuorum == 0. ' +
        'mvxsafe shows a ChangeQuorum(0) proposal with no warning and renders this ' +
        'state as quorum "unknown"; with quorum 0 every action is performable with ' +
        'no signatures by any single board member or proposer.'
    );
    process.exit(1);
  }
  console.log('\nSC-02 not reproducing now (quorum is not 0).');
  process.exit(0);
};
run().catch((e) => {
  console.error(`SC-02 proof could not complete: ${e.message}`);
  process.exit(2);
});
