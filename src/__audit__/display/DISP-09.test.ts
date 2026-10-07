/**
 * @jest-environment node
 *
 * Node, not jsdom: the SDK hands decoded bytes back as node Buffers, and under
 * jest-environment-jsdom a Buffer is not instanceof the jsdom realm's Uint8Array,
 * which is a harness artefact a browser does not have (one realm).
 */
// DISP-09: SCDeployFromSource and SCUpgradeFromSource are described in three
// words. An upgrade replaces the code of a contract the safe owns with code
// copied from any address the proposer names; a deploy can carry EGLD. The
// signer is shown neither the contract, nor the source, nor the amount.
jest.mock('multisig/network', () => require('./fixtures').networkMock);

import { readPendingActions } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from './fixtures';

const OWNED = 'erd1qqqqqqqqqqqqqpgqlyf6f9xptftuaceks5rh0ru9u598mkv6aujqgu4hyw';
const ATTACKER_CODE = 'erd1qqqqqqqqqqqqqpgqfhtkpf9warq5w7eny4az9epxt26gxyvgaujqlz7cqq';

const describe1 = async (pendingAction: any) => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [{ id: 8, action: pendingAction, signers: [BOB] }] });
  const [action] = await readPendingActions(SAFE);
  return action.description;
};

test('control: the action is recognised as an upgrade', async () => {
  const text = await describe1({ kind: 'SCUpgradeFromSource', scAddress: OWNED, source: ATTACKER_CODE });
  expect(text.toLowerCase()).toContain('upgrade');
});

test('an upgrade must name the contract whose code is replaced and where the new code comes from', async () => {
  const text = await describe1({ kind: 'SCUpgradeFromSource', scAddress: OWNED, source: ATTACKER_CODE });
  expect(text).toContain('erd1qqqqqqqqqqqqqpgqlyf6'); // the contract being replaced
  expect(text).toContain('erd1qqqqqqqqqqqqqpgqfhtk'); // the source of the new code
});

test('a deploy must name the source of the code and the EGLD it carries', async () => {
  const text = await describe1({ kind: 'SCDeployFromSource', amount: 50n * 10n ** 18n, source: ATTACKER_CODE, args: ['\u0001', ALICE] });
  expect(text).toContain('erd1qqqqqqqqqqqqqpgqfhtk');
  expect(text).toMatch(/50 EGLD/);
});
