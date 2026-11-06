// The two vesting forms (6 Nov 2026): what is refused before anything reaches
// a wallet, what the signers will see, and exactly what is proposed. The
// mvxvest reads are replaced here; vestingReads.ts reads them on devnet.
jest.mock(
  'multisig/network',
  () => require('./contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({
  proposeVestings: jest.fn(async () => 'session'),
  proposeCancelVesting: jest.fn(async () => 'session')
}));
jest.mock('multisig/vestingReads', () => ({
  ...jest.requireActual('multisig/vestingReads'),
  readVestingFacts: jest.fn(
    async () => mockFacts.answers.shift() ?? mockFacts.current
  ),
  readHeldCancelKeys: jest.fn(async () => mockKeys.current)
}));

import '../../__audit__/display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CancelVestingForm } from 'components/Propose/CancelVestingForm';
import { ProposePanel } from 'components/Propose/ProposePanel';
import { VestingForm } from 'components/Propose/VestingForm';
import { proposeCancelVesting, proposeVestings } from 'multisig/actions';
import { mvxvestFor, trancheSchedule, VestingFacts } from 'multisig/vesting';
import type { HeldCancelKey, VestingState } from 'multisig/vestingReads';
import { ALICE, BOB, SAFE } from '../../__audit__/display/fixtures';

const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 18n;
const pin = mvxvestFor('devnet')!;
const TOKEN = 'FOXSY-5d5f3e';
const tokens = [
  {
    identifier: TOKEN,
    ticker: 'FOXSY',
    name: 'Foxsy',
    balance: (1000n * UNIT).toString(),
    decimals: 18,
    amount: 1000
  }
];
const signer = { address: ALICE, nonce: 1 };
const factsWith = (over: Partial<VestingFacts> = {}): VestingFacts => ({
  codeHash: V4,
  creationPaused: false,
  claimKeyIssued: true,
  cancelKeyIssued: true,
  fee: 0n,
  tokenFeeBps: 0,
  safePayableBySc: true,
  safeBalance: 1000n * UNIT,
  safeEgld: UNIT,
  ...over
});
const mockFacts: { current: VestingFacts; answers: VestingFacts[] } = {
  current: factsWith(),
  answers: []
};
const mockKeys: { current: HeldCancelKey[] } = { current: [] };
const year = new Date().getUTCFullYear() + 1;

beforeEach(() => {
  jest.clearAllMocks();
  mockFacts.current = factsWith();
  mockFacts.answers = [];
  mockKeys.current = [];
});

const renderVesting = async () => {
  render(
    <VestingForm
      safe={SAFE}
      signer={signer}
      tokens={tokens}
      onProposed={() => undefined}
    />
  );
  await act(async () => undefined);
};
const rows = (text: string) =>
  fireEvent.change(
    screen.getByLabelText(/Tranches, one a line/, { selector: 'textarea' }),
    { target: { value: text } }
  );
const propose = () => screen.getByRole('button', { name: 'Propose' });

describe('Create vestings', () => {
  it('shows the signers every vesting, then proposes exactly the rows', async () => {
    await renderVesting();
    rows(
      [
        `${ALICE}, ${year}-05-01, 4`,
        `${BOB}, ${year}-05-01, 6`,
        `${ALICE}, ${year}-11-01, 6`
      ].join('\n')
    );
    fireEvent.change(screen.getByLabelText(/^Label/, { selector: 'input' }), {
      target: { value: 'Grants' }
    });
    expect(screen.getByText('2 vestings, 3 tranches')).toBeInTheDocument();
    expect(screen.getByText(/fees read zero now/)).toBeInTheDocument();
    expect(screen.getByText(ALICE)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(propose());
    });
    expect(proposeVestings).toHaveBeenCalledTimes(1);
    const [, safe, input] = (proposeVestings as jest.Mock).mock.calls[0];
    expect(safe).toBe(SAFE);
    expect(input).toMatchObject({
      pin,
      token: TOKEN,
      cancelable: true,
      label: 'Grants',
      decimals: 18
    });
    expect(input.entries).toEqual([
      {
        beneficiary: ALICE,
        schedule: trancheSchedule([
          { time: Date.UTC(year, 4, 1) / 1000, amount: 4n * UNIT },
          { time: Date.UTC(year, 10, 1) / 1000, amount: 6n * UNIT }
        ])
      },
      {
        beneficiary: BOB,
        schedule: trancheSchedule([
          { time: Date.UTC(year, 4, 1) / 1000, amount: 6n * UNIT }
        ])
      }
    ]);
  });

  it('refuses a date in the past before anything reaches the wallet', async () => {
    await renderVesting();
    rows(`${ALICE}, 2020-05-01, 4`);
    expect(screen.getByText(/is in the past/)).toBeInTheDocument();
    expect(propose()).toBeDisabled();
  });

  it("names mvxvest's fees, and how to create without them", async () => {
    mockFacts.current = factsWith({ fee: 10n ** 17n, tokenFeeBps: 10 });
    await renderVesting();
    rows(`${ALICE}, ${year}-05-01, 1000`);
    expect(
      screen.getByText(/charges 0\.1 EGLD a vesting and 0\.1% of each/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 FOXSY-5d5f3e and 0\.1 EGLD for this batch/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/set both to zero first \(setFee 0 and setTokenFee 0\)/)
    ).toBeInTheDocument();
  });

  it('proposes nothing when the fees changed between showing them and pressing Propose', async () => {
    await renderVesting();
    rows(`${ALICE}, ${year}-05-01, 4`);
    mockFacts.answers = [factsWith({ fee: 10n ** 17n })];
    await act(async () => {
      fireEvent.click(propose());
    });
    expect(proposeVestings).not.toHaveBeenCalled();
    expect(screen.getByText(/fees changed just now/)).toBeInTheDocument();
  });

  it("writes one person's half-yearly schedule into the rows", async () => {
    await renderVesting();
    fireEvent.change(screen.getByLabelText('Beneficiary'), {
      target: { value: ALICE }
    });
    fireEvent.change(screen.getByLabelText('Total'), {
      target: { value: '800' }
    });
    fireEvent.change(screen.getByLabelText('First tranche'), {
      target: { value: `${year}-01-15` }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Add these tranches to the rows' })
    );
    const text = (
      screen.getByLabelText(/Tranches, one a line/, {
        selector: 'textarea'
      }) as HTMLTextAreaElement
    ).value.split('\n');
    expect(text).toHaveLength(8);
    expect(text[0]).toBe(`${ALICE}, ${year}-01-15, 100`);
    expect(text[7]).toBe(`${ALICE}, ${year + 3}-07-15, 100`);
  });

  it('refuses a safe that cannot receive the keys', async () => {
    mockFacts.current = factsWith({ safePayableBySc: false });
    await renderVesting();
    rows(`${ALICE}, ${year}-05-01, 4`);
    expect(
      screen.getByText(/not payable by smart contracts/)
    ).toBeInTheDocument();
    expect(propose()).toBeDisabled();
  });
});

describe('Cancel a vesting', () => {
  const state: VestingState = {
    id: 7,
    creator: SAFE,
    beneficiary: BOB,
    token: TOKEN,
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

  it('lists the keys with what a cancel now would do, and proposes the one chosen', async () => {
    mockKeys.current = [
      { identifier: `${pin.cancelKey}-05`, nonce: 5, vesting: state },
      {
        identifier: `${pin.cancelKey}-06`,
        nonce: 6,
        vesting: { ...state, id: 8, cancelledAt: 3 }
      }
    ];
    render(
      <CancelVestingForm
        safe={SAFE}
        signer={signer}
        onProposed={() => undefined}
      />
    );
    await act(async () => undefined);
    expect(
      screen.getByText(
        /0 FOXSY-5d5f3e stays theirs to claim and 10 FOXSY-5d5f3e comes back to this safe/
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Already cancelled/)).toBeInTheDocument();
    const [first, second] = screen.getAllByRole('radio');
    expect(second).toBeDisabled();
    fireEvent.click(first);
    await act(async () => {
      fireEvent.click(propose());
    });
    expect(proposeCancelVesting).toHaveBeenCalledWith(
      signer,
      SAFE,
      expect.objectContaining({ pin, collection: pin.cancelKey, nonce: 5 })
    );
  });

  it('says when the safe holds no key', async () => {
    render(
      <CancelVestingForm
        safe={SAFE}
        signer={signer}
        onProposed={() => undefined}
      />
    );
    await act(async () => undefined);
    expect(
      screen.getByText(/holds no cancel key of mvxvest/)
    ).toBeInTheDocument();
  });
});

describe('the propose panel', () => {
  it('offers both on a network with mvxvest pinned', async () => {
    render(
      <ProposePanel
        safe={SAFE}
        signer={signer}
        tokens={tokens}
        boardSize={3}
        onProposed={() => undefined}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Create vestings' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Cancel a vesting' })
    ).toBeInTheDocument();
  });
});

describe('the holdings', () => {
  it('list each cancel key the safe holds with the vesting it stops', async () => {
    const { HeldCancelKeys } =
      await import('components/Pending/HeldCancelKeys');
    mockKeys.current = [
      {
        identifier: `${pin.cancelKey}-05`,
        nonce: 5,
        vesting: {
          id: 7,
          creator: SAFE,
          beneficiary: BOB,
          token: TOKEN,
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
        }
      }
    ];
    render(
      <ul>
        <HeldCancelKeys safe={SAFE} nftCount={3} />
      </ul>
    );
    await act(async () => undefined);
    expect(screen.getByText(/mvxvest cancel keys: 1/)).toBeInTheDocument();
    expect(screen.getByText(`${pin.cancelKey}-05`)).toBeInTheDocument();
    expect(screen.getByText(/vesting #7, "Grants", to/)).toBeInTheDocument();
  });

  it('read nothing when the safe holds no NFT', async () => {
    const { HeldCancelKeys } =
      await import('components/Pending/HeldCancelKeys');
    const { readHeldCancelKeys } = await import('multisig/vestingReads');
    render(
      <ul>
        <HeldCancelKeys safe={SAFE} nftCount={0} />
      </ul>
    );
    await act(async () => undefined);
    expect(readHeldCancelKeys).not.toHaveBeenCalled();
  });
});
