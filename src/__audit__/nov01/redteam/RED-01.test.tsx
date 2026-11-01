// RED-01 (redteam audit, 1 Nov 2026): a safe is trusted on its views alone.
//
// The page reads the contract's code hash on every load (readContractInfo) and
// the app ships the hash of the one multisig it was tested against
// (MULTISIG_CODE_HASH), but never compares the two. Any contract that answers
// getQuorum, getAllBoardMembers, getPendingActionFullInfo and the other views
// like a multisig, that owns itself and lists the right board, is shown as a
// "2 of 3" safe in good standing: no banner, Sign offered. What its
// performAction (or a hidden endpoint) really does is invisible here.
//
// The chain: whoever "sets up the safe" deploys a modified multisig, hands it
// to itself, gives it the real board and sends the link. Every check the page
// makes is green, the safe is funded, and the first vote of any kind (or a
// call only the deployer can make) empties it. No quorum of the real board
// is needed for the drain, only for the funding, which the page encouraged.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
import { screen } from '@testing-library/react';
import { MULTISIG_CODE_HASH } from 'multisig/legacyCalls';
import {
  ALICE,
  BOB,
  CAROL,
  networkMock,
  SAFE,
  useChain
} from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

// The code of another contract altogether (a vesting contract's release),
// base64 as the API states every code hash.
const OTHER_CODE_HASH = Buffer.from(
  'a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a',
  'hex'
).toString('base64');

const baseApi = networkMock.api;
/** What the API says about the safe's own account; the views stay a multisig's. */
const accountSays = (fields: Record<string, unknown>) => {
  (networkMock as any).api = async (path: string) => {
    if (path === `/accounts/${SAFE}`) {
      return { balance: '0', ownerAddress: SAFE, ...fields };
    }
    return baseApi(path);
  };
};
afterEach(() => {
  (networkMock as any).api = baseApi;
});

// What a fix has to say, somewhere on the page: that this address does not
// run the multisig the app knows, or that its code could not be verified.
const NOT_THE_MULTISIG =
  /\b(not|other than|unknown|differs?|does not match|could not be (?:verified|checked)|unverified)\b[^.]*\b(multisig|code)\b/i;

beforeEach(() => {
  connectAs(BOB);
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: [
      { id: 1, action: { kind: 'ChangeQuorum', quorum: 2 }, signers: [ALICE] }
    ]
  });
});

test('control: a safe running the known multisig and owning itself shows no code warning and offers Sign', async () => {
  accountSays({ codeHash: MULTISIG_CODE_HASH });
  await renderSafe(SAFE);
  expect(screen.queryByText(NOT_THE_MULTISIG)).toBeNull();
  expect(screen.queryByText(/not in its own hands/)).toBeNull();
  expect(screen.getByText('2 of 3')).toBeTruthy();
  expect((screen.getByText('Sign') as HTMLButtonElement).disabled).toBe(false);
});

test('a contract running OTHER code, owning itself and answering the views like a multisig, is flagged', async () => {
  accountSays({ codeHash: OTHER_CODE_HASH });
  await renderSafe(SAFE);
  // Today: "2 of 3", no banner, Sign enabled, exactly as for a real safe.
  expect(screen.getByText(NOT_THE_MULTISIG)).toBeTruthy();
});

test('a contract whose code the API does not show at all is not presented as a verified safe', async () => {
  // No codeHash in the answer while every view answers: the page treats it as
  // "no contract yet" (ownsItself) and shows it like a real safe.
  accountSays({});
  await renderSafe(SAFE);
  expect(screen.getByText(NOT_THE_MULTISIG)).toBeTruthy();
});
