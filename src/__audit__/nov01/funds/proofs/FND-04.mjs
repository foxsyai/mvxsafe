// FND-04 devnet proof, read-only (no key, no transaction).
//
// The audit safe erd1qqqqqqqqqqqqqpgqzjnsjfn0yg6cylatfgrpkac000f5az22mg8ss8c7ea owns a
// small contract. Action #11 was an SCUpgradeFromSource of that contract whose source
// runs the legacy multisig code, which exports no `upgrade` function. It was carried out in
//   232c7ce4c2f94a154a5ed2fee32413811d705916eb11ff312d9938c0e52ae63b
// which failed ("invalid function (not found)" on upgradeContract), left the code as it was,
// and used the action up with its signature. Action #12, the same upgrade from a source whose
// code exports `upgrade`, with 0.001 EGLD, succeeded in
//   37773ea6c8e1359d0a3fa4519cb0bdc10dd6fe4005808b181acd3e98ba4c6d8e
// and the EGLD left the safe.
//
// Exit 1 while the network still shows the wasted vote: #11 gone, the owned contract still
// running the code it ran before, and the perform marked as failed for that reason.
const API = 'https://devnet-api.multiversx.com';
const GATEWAY = 'https://devnet-gateway.multiversx.com';
const SAFE = 'erd1qqqqqqqqqqqqqpgqzjnsjfn0yg6cylatfgrpkac000f5az22mg8ss8c7ea';
const OWNED = 'erd1qqqqqqqqqqqqqpgqt7gkxh4a4rqsunake3prr3s8p7wnp4wjmg8sv42dpy';
const ORIGINAL_CODE_HASH = 'qJHyEn4s+ynLS0p7RwCMxPZOolbBNTwCaBUUK6bMxLA=';
const PERFORM =
  '232c7ce4c2f94a154a5ed2fee32413811d705916eb11ff312d9938c0e52ae63b';
const ACTION = 11;
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
  const owned = await (await fetch(`${API}/accounts/${OWNED}`)).json();
  const perform = await (await fetch(`${API}/transactions/${PERFORM}`)).json();
  const action = await query('getActionData', [
    ACTION.toString(16).padStart(2, '0')
  ]);
  const reason = (perform.logs?.events ?? [])
    .filter((e) => e.identifier === 'internalVMErrors')
    .map((e) => Buffer.from(e.data ?? '', 'base64').toString())
    .join(' ');
  console.log(
    `owned contract ${OWNED}: owner ${owned.ownerAddress === SAFE ? 'the safe' : owned.ownerAddress}, codeHash ${owned.codeHash}`
  );
  console.log(
    `perform ${PERFORM}: status ${perform.status}, reason: ${reason.replace(/\s+/g, ' ').trim().slice(0, 120)}`
  );
  console.log(
    `getActionData(${ACTION}) -> ${JSON.stringify(action)} (empty = Nothing: used up)`
  );
  const wasted =
    owned.codeHash === ORIGINAL_CODE_HASH &&
    perform.status === 'fail' &&
    /invalid function \(not found\)/.test(reason) &&
    action.code === 'ok' &&
    action.data[0] === '';
  if (wasted) {
    console.log(
      '\nFND-04 REPRODUCED: an upgrade from a source without an upgrade function failed after the signatures, used the vote up, and changed nothing. The card for such an action carries no warning.'
    );
    process.exit(1);
  }
  console.log('\nFND-04 not reproducing (state changed).');
  process.exit(0);
};
run().catch((e) => {
  console.error(`proof could not complete: ${e.message}`);
  process.exit(2);
});
