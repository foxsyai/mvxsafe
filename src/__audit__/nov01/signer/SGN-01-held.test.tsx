// What SGN-01 and RED-01 do not pin: which buttons are held, for what, and that
// a failed read does not hold them for ever. A contract with another code hash
// has no override, and every button that ends in the wallet waits. One whose
// code could not be read waits too, with a way to check again, and a hash read
// once is not taken back by a moment of a flaky API.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MULTISIG_CODE_HASH } from 'multisig/legacyCalls';
import { identityOf } from 'multisig/reads';
import { Safes } from 'pages/Safes/Safes';
import {
  ALICE,
  BOB,
  CAROL,
  networkMock,
  SAFE,
  useChain
} from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

const OTHER_HASH = Buffer.from('44'.repeat(32), 'hex').toString('base64');

const baseApi = networkMock.api;
let accountAnswer: () => unknown;
beforeEach(() => {
  (networkMock as any).api = async (path: string) =>
    path === `/accounts/${SAFE}` ? accountAnswer() : baseApi(path);
  accountAnswer = () => account(MULTISIG_CODE_HASH);
  connectAs(BOB);
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: [
      // Ready, and signed by the viewer: Remove my signature and Carry it out.
      {
        id: 1,
        action: { kind: 'ChangeQuorum', quorum: 2 },
        signers: [ALICE, BOB]
      },
      // Unsigned: Sign and Discard.
      { id: 2, action: { kind: 'ChangeQuorum', quorum: 3 }, signers: [] }
    ]
  });
});
afterEach(() => {
  (networkMock as any).api = baseApi;
});

const account = (codeHash?: string) => ({
  balance: '0',
  ownerAddress: SAFE,
  codeHash
});

const pressable = (name: string) =>
  screen
    .getAllByRole('button', { name })
    .map((button) => !(button as HTMLButtonElement).disabled);

const allHeld = () => {
  for (const name of [
    'Sign',
    'Carry it out',
    'Discard',
    'Remove my signature',
    'Propose'
  ]) {
    expect(pressable(name)).not.toContain(true);
  }
};

test('identityOf: the multisig, another code, and no answer', () => {
  expect(identityOf(MULTISIG_CODE_HASH)).toBe('known');
  expect(identityOf(OTHER_HASH)).toBe('other');
  expect(identityOf('')).toBe('unverified');
  expect(identityOf(undefined)).toBe('unverified');
  expect(identityOf('not a hash')).toBe('unverified');
});

test('control: the genuine multisig offers every button, with no banner', async () => {
  await renderSafe(SAFE);
  expect(screen.queryByText(/mvxsafe does not know this code/)).toBeNull();
  expect(screen.queryByText(/could not be verified/)).toBeNull();
  expect(pressable('Sign')).toEqual([true]);
  expect(pressable('Carry it out')).toEqual([true]);
  expect(pressable('Discard')).toContain(true);
  expect(pressable('Remove my signature')).toEqual([true]);
  expect(pressable('Propose')).toEqual([true]);
});

test('another code hash: the red banner, with both hashes, and everything held', async () => {
  accountAnswer = () => account(OTHER_HASH);
  await renderSafe(SAFE);
  const banner = screen.getByText(/mvxsafe does not know this code/);
  expect(banner.textContent).toMatch(/comes from the contract itself/);
  expect(screen.getByText(/Its code hash is 4444/)).toBeTruthy();
  expect(screen.queryByText('Check again')).toBeNull();
  // The role is the contract's word, and the page does not promise a signature.
  expect(screen.getByText(/by this contract's own word/)).toBeTruthy();
  allHeld();
});

test("another code hash in a wallet's hands: no offer to hand it to itself", async () => {
  accountAnswer = () => ({ ...account(OTHER_HASH), ownerAddress: BOB });
  await renderSafe(SAFE);
  expect(screen.getByText(/not in its own hands/)).toBeTruthy();
  expect(screen.queryByText('Hand it to itself now')).toBeNull();
});

test('no hash while the views answer: could not be verified, held, and Check again releases it', async () => {
  accountAnswer = () => account(undefined);
  await renderSafe(SAFE);
  expect(screen.getByText(/could not be verified/)).toBeTruthy();
  allHeld();
  accountAnswer = () => account(MULTISIG_CODE_HASH);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  });
  expect(screen.queryByText(/could not be verified/)).toBeNull();
  expect(pressable('Sign')).toEqual([true]);
});

test('a read that failed is asked again by itself, and does not stick', async () => {
  let calls = 0;
  accountAnswer = () => {
    // The first answer is the code check's: only that one read fails.
    if (++calls === 1) throw new Error('answered 500');
    return account(MULTISIG_CODE_HASH);
  };
  await renderSafe(SAFE);
  expect(screen.getByText(/could not be verified/)).toBeTruthy();
  allHeld();
  await act(() => new Promise((resolve) => setTimeout(resolve, 5500)));
  expect(screen.queryByText(/could not be verified/)).toBeNull();
  expect(pressable('Sign')).toEqual([true]);
}, 15000);

test('a hash read once is not taken back by a later failure or an answer without one', async () => {
  await renderSafe(SAFE);
  expect(pressable('Sign')).toEqual([true]);
  // A Refresh answered without a hash: balances and all still answer.
  accountAnswer = () => account(undefined);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  });
  await screen.findByText('Refresh');
  expect(screen.queryByText(/could not be verified/)).toBeNull();
  expect(pressable('Sign')).toEqual([true]);
  // A Refresh whose read fails: stale holds the buttons, the verdict stays.
  accountAnswer = () => {
    throw new Error('answered 500');
  };
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  });
  await screen.findByText('Refresh');
  expect(screen.queryByText(/could not be verified/)).toBeNull();
  expect(screen.getByText(/did not answer just now/)).toBeTruthy();
});

test('the upgradeable fact of a genuine safe is on the overview', async () => {
  accountAnswer = () => ({
    ...account(MULTISIG_CODE_HASH),
    isUpgradeable: true
  });
  await renderSafe(SAFE);
  expect(
    screen.getByText(/Upgradeable: its board can replace it/)
  ).toBeTruthy();
});

describe('the list', () => {
  const openList = async () => {
    window.localStorage.setItem(
      'mvxsafe.savedSafes',
      JSON.stringify([{ name: 'Look-alike', address: SAFE }])
    );
    render(
      <MemoryRouter>
        <Safes />
      </MemoryRouter>
    );
    await screen.findByText('Refresh', {}, { timeout: 8000 });
  };
  afterEach(() => window.localStorage.clear());

  test("control: a genuine safe's card carries no line", async () => {
    await openList();
    expect(screen.getByText('Look-alike')).toBeTruthy();
    expect(screen.queryByText(/mvxsafe does not know this code/)).toBeNull();
  });

  test('a contract with another code hash stays listed, with the same line', async () => {
    accountAnswer = () => account(OTHER_HASH);
    await openList();
    expect(screen.getByText('Look-alike')).toBeTruthy();
    expect(screen.getByText(/mvxsafe does not know this code/)).toBeTruthy();
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  test('no hash while the views answer: could not be verified', async () => {
    accountAnswer = () => account(undefined);
    await openList();
    expect(screen.getByText(/could not be verified/)).toBeTruthy();
  });
});
