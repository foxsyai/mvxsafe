// VFM-03: a cancel is proposed from a safe that smart contracts cannot pay
// (vestings-from-a-safe audit, 6 Nov 2026).
//
// mvxvest's cancel() burns the key and pays the unvested rest back to the
// caller with a plain transfer (claim.rs, send_each). A safe that is not
// payable by smart contracts cannot receive it: from another shard the
// refund bounces back to mvxvest, where only mvxvest's owner can move it
// (recoverSurplus), while the key is already burned. That is a refund lost
// to the safe. Create vestings refuses such a safe (vestingProblem: "the
// cancel keys and refunds mvxvest sends back could not reach it"), and the
// card of a pending cancel is red for it ("what the cancel pays back may
// never reach it. Do not sign it."). The Cancel form and its builder do not
// check it: cancelProblem (multisig/vesting.js) never looks at
// facts.safePayableBySc, although readVestingFacts reads it for them. The
// safe's metadata can change after its keys arrived (an upgrade of the safe
// with other code metadata, which the Upgrade form offers), so the form can
// meet a key it must not send.
//
// The fix: cancelProblem refuses when facts.safePayableBySc is false, with
// the same words as vestingProblem; the form shows it and holds Propose.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);
jest.mock('multisig/actions', () => ({
  proposeCancelVesting: jest.fn(async () => 'session')
}));
jest.mock('multisig/vestingReads', () => ({
  ...jest.requireActual('multisig/vestingReads'),
  readVestingFacts: jest.fn(async () => mockFacts.current),
  readHeldCancelKeys: jest.fn(async () => mockKeys.current)
}));

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CancelVestingForm } from 'components/Propose/CancelVestingForm';
import { proposeCancelVesting } from 'multisig/actions';
import {
  buildProposeCancelVesting,
  mvxvestFor,
  trancheSchedule,
  VestingFacts
} from 'multisig/vesting';
import type { HeldCancelKey, VestingState } from 'multisig/vestingReads';
import { ALICE, BOB, SAFE } from '../../display/fixtures';

const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 18n;
const pin = mvxvestFor('devnet')!;
const year = new Date().getUTCFullYear() + 1;

const factsWith = (over: Partial<VestingFacts> = {}): VestingFacts => ({
  codeHash: V4,
  creationPaused: false,
  claimKeyIssued: true,
  cancelKeyIssued: true,
  claimKeyCollection: pin.claimKey,
  cancelKeyCollection: pin.cancelKey,
  fee: 0n,
  tokenFeeBps: 0,
  safePayableBySc: true,
  safeBalance: 1000n * UNIT,
  safeEgld: UNIT,
  ...over
});
const vesting: VestingState = {
  id: 7,
  creator: SAFE,
  beneficiary: BOB,
  token: 'FOXSY-5d5f3e',
  total: 10n * UNIT,
  schedule: trancheSchedule([
    { time: Date.UTC(year, 4, 1) / 1000, amount: 10n * UNIT }
  ]),
  cancelable: true,
  createdAt: 1,
  claimNonce: 9,
  cancelNonce: 5,
  label: 'Grants',
  claimed: 0n,
  cancelledAt: 0,
  vested: 0n,
  claimable: 0n,
  finalAmount: 0n,
  refunded: 0n,
  timestamp: 2
};
const mockFacts: { current: VestingFacts } = { current: factsWith() };
const mockKeys: { current: HeldCancelKey[] } = {
  current: [{ identifier: `${pin.cancelKey}-05`, nonce: 5, vesting }]
};

const renderAndChoose = async () => {
  render(
    <CancelVestingForm
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onProposed={() => undefined}
    />
  );
  await act(async () => undefined);
  fireEvent.click(screen.getByRole('radio'));
  return screen.getByRole('button', { name: 'Propose' });
};

const context = { chainId: 'D', sender: ALICE, nonce: 1, safe: SAFE };
const cancelInput = (facts: VestingFacts) => ({
  pin,
  facts,
  collection: pin.cancelKey,
  nonce: 5
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFacts.current = factsWith();
});

describe('VFM-03: no cancel from a safe the refund cannot reach', () => {
  it('control: a safe payable by smart contracts proposes the cancel', async () => {
    const propose = await renderAndChoose();
    expect(propose).toBeEnabled();
    await act(async () => {
      fireEvent.click(propose);
    });
    expect(proposeCancelVesting).toHaveBeenCalledTimes(1);
    await expect(
      buildProposeCancelVesting(context, cancelInput(factsWith()))
    ).resolves.toBeTruthy();
  });

  it('the form holds Propose and says why when the safe is not payable by smart contracts', async () => {
    mockFacts.current = factsWith({ safePayableBySc: false });
    const propose = await renderAndChoose();
    expect(
      screen.getByText(/not payable by smart contracts/)
    ).toBeInTheDocument();
    expect(propose).toBeDisabled();
  });

  it('the builder refuses it too, as it does for a creation', async () => {
    await expect(
      buildProposeCancelVesting(
        context,
        cancelInput(factsWith({ safePayableBySc: false }))
      )
    ).rejects.toThrow(/not payable by smart contracts/);
  });
});
