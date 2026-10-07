// Refreshes recorded-devnet.json from the two devnet audit safes (read-only, no keys).
// The jest tests DISP-01, DISP-02 and DISP-05 run on these bytes as well as on hand-made ones.
//   node src/__audit__/display/proofs/refresh-recorded-devnet.mjs
import { fileURLToPath } from 'node:url';
import { Address } from '@multiversx/sdk-core';
const A = 'erd1qqqqqqqqqqqqqpgqfhtkpf9warq5w7eny4az9epxt26gxyvgaujqlz7cqq';
const B = 'erd1qqqqqqqqqqqqqpgqlyf6f9xptftuaceks5rh0ru9u598mkv6aujqgu4hyw';
const q = async (sc, fn, args = []) => {
  const r = await (await fetch('https://devnet-api.multiversx.com/vm-values/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scAddress: sc, funcName: fn, args }) })).json();
  if (r.data?.data?.returnCode !== 'ok') throw new Error(`${fn}: ${JSON.stringify(r).slice(0, 200)}`);
  return r.data.data.returnData;
};
const out = { recordedAt: new Date().toISOString(), safeA: { address: A }, safeB: { address: B } };
for (const [key, sc] of [['safeA', A], ['safeB', B]]) {
  for (const fn of ['getQuorum', 'getAllBoardMembers', 'getNumProposers', 'getActionLastIndex', 'getPendingActionFullInfo']) {
    out[key][fn] = await q(sc, fn);
    await new Promise((r) => setTimeout(r, 300));
  }
  out[key].board = out[key].getAllBoardMembers.map((b) => new Address(Buffer.from(b, 'base64')).toBech32());
}
out.safeB.getActionValidSignerCount_1 = await q(B, 'getActionValidSignerCount', ['01']);
out.safeB.quorumReached_1 = await q(B, 'quorumReached', ['01']);
out.safeB.getActionSigners_1 = await q(B, 'getActionSigners', ['01']);
writeFileSync(fileURLToPath(new URL('../recorded-devnet.json', import.meta.url)), JSON.stringify(out, null, 2) + '\n');
console.log('safeA pending entries:', out.safeA.getPendingActionFullInfo.length, '| board', out.safeA.board.length);
console.log('safeB pending entries:', out.safeB.getPendingActionFullInfo.length, '| board', out.safeB.board, '| validSignerCount(1):', out.safeB.getActionValidSignerCount_1, '| quorumReached(1):', out.safeB.quorumReached_1, '| signers(1):', out.safeB.getActionSigners_1);
