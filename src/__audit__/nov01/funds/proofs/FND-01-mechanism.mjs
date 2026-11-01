// FND-01, the contract mechanism, read-only on devnet (no key, no transaction).
//
// On the audit safe below, action #7 is "send 0.001 EGLD" proposed and signed by
// one board member, E, and nobody else. E was then removed from the board
// (RemoveUser carried out in c2917b04c112129551f52140596291ef576107673dcb36cbd9db7d5dbd3a3efa):
// getActionValidSignerCount(7) answered 0, quorumReached(7) answered false, and a
// performAction(7) was refused with "quorum has not been reached"
// (3687c0457ab12907f21202e2bd3bb7fe59625d6f3025594e1f4e001201e09e30). E was then
// re-added (AddBoardMember carried out in 314b38e103cf9a5f22250585a27a81702046a891b68a39fbf0c9291aa50e2947),
// and E's old signature counts again: valid 1, quorumReached true, with a quorum of 1.
//
// Signatures are stored as user ids; a removed member keeps their id, with the role
// None; only ids whose role is BoardMember today are counted. Re-adding a member
// revives every signature they ever left on an action still pending.
//
// Exit 1 while the revived signature alone reaches the quorum on #7 (the state the
// page shows nothing about on the re-add's card), 0 once #7 is gone or no longer ready.
const GATEWAY = 'https://devnet-gateway.multiversx.com';
const SAFE = 'erd1qqqqqqqqqqqqqpgqzjnsjfn0yg6cylatfgrpkac000f5az22mg8ss8c7ea';
const ACTION = 7;
const hex = (n) => n.toString(16).padStart(2, '0');
const query = async (funcName, args = []) => {
  const resp = await (
    await fetch(`${GATEWAY}/vm-values/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scAddress: SAFE, funcName, args })
    })
  ).json();
  const d = resp?.data?.data ?? {};
  return {
    code: d.returnCode,
    data: (d.returnData ?? []).map((p) =>
      Buffer.from(p, 'base64').toString('hex')
    )
  };
};
const run = async () => {
  const signers = await query('getActionSigners', [hex(ACTION)]);
  const valid = await query('getActionValidSignerCount', [hex(ACTION)]);
  const reached = await query('quorumReached', [hex(ACTION)]);
  const quorum = await query('getQuorum');
  const data = await query('getActionData', [hex(ACTION)]);
  console.log(`safe ${SAFE}, action #${ACTION}`);
  console.log(`  getActionData          -> ${JSON.stringify(data)}`);
  console.log(`  getActionSigners       -> ${JSON.stringify(signers)}`);
  console.log(`  getActionValidSignerCount -> ${JSON.stringify(valid)}`);
  console.log(
    `  quorumReached          -> ${JSON.stringify(reached)} (01 = true)`
  );
  console.log(`  getQuorum              -> ${JSON.stringify(quorum)}`);
  const pending = data.code === 'ok' && data.data[0] !== '';
  const ready = reached.code === 'ok' && reached.data[0] === '01';
  if (pending && ready) {
    console.log(
      '\nFND-01 MECHANISM LIVE: the only signature on this action was left by a member who was removed and re-added since; it reaches the quorum again.'
    );
    process.exit(1);
  }
  console.log(
    '\nFND-01 mechanism not live on this action (gone, or not ready).'
  );
  process.exit(0);
};
run().catch((e) => {
  console.error(`proof could not complete: ${e.message}`);
  process.exit(2);
});
