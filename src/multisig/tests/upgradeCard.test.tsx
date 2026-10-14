// What a signer sees on a pending upgrade or call, through the shipped Safe
// page: the decoded action, the checks read from the chain, the code hashes
// with a field for the release's own, and the gas a perform will be given.
jest.mock(
  'multisig/network',
  () => require('./contractsMock').contractsNetworkMock
);
jest.mock('lib', () => require('../../__audit__/display/mocks').libMock);
jest.mock('multisig/actions', () => ({
  ...require('../../__audit__/display/mocks').actionsMock,
  performAction: jest.fn(async () => undefined)
}));

import '../../__audit__/display/restoreSetImmediate';
import { Address } from '@multiversx/sdk-core';
import { act, fireEvent, screen } from '@testing-library/react';
import { performAction } from 'multisig/actions';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  ALICE,
  BOB,
  CAROL,
  SAFE,
  useChain
} from '../../__audit__/display/fixtures';
import { connectAs, renderSafe } from '../../__audit__/display/renderSafe';
import { contract, mockAccounts, mockTrial } from './contractsMock';

// SAFE lives in shard 1. ALICE is in shard 1 and CAROL in shard 0, so what
// they deploy lands in those shards.
const TARGET = predictSafeAddress(CAROL, 40); // shard 0, like mvxvest on mainnet
const SOURCE = predictSafeAddress(ALICE, 60); // shard 1, the safe's
const WRONG_SHARD_SOURCE = predictSafeAddress(CAROL, 41); // shard 0
const NEW_CODE =
  'fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32';
const OLD_CODE = '11'.repeat(32);

const upgrade = (source: string, metadata = Uint8Array.of(0x05, 0x00)) => ({
  kind: 'SCUpgradeFromSource' as const,
  scAddress: TARGET,
  source,
  codeMetadata: metadata
});

const show = async (action: any, signers: string[] = [ALICE]) => {
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: [{ id: 5, action, signers }]
  });
  await renderSafe(SAFE);
};

const tones = () =>
  Array.from(document.querySelectorAll('[data-tone]')).map(
    (node) => `${node.getAttribute('data-tone')}: ${node.textContent}`
  );

beforeEach(() => {
  connectAs(BOB);
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: OLD_CODE });
  mockAccounts[SOURCE] = contract({
    owner: ALICE,
    hash: NEW_CODE,
    upgradeable: false
  });
  mockAccounts[WRONG_SHARD_SOURCE] = contract({
    owner: CAROL,
    hash: NEW_CODE,
    upgradeable: false
  });
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
  (performAction as jest.Mock).mockClear();
});

describe('a pending upgrade', () => {
  test('says the metadata in words and shows both code hashes, with every check green', async () => {
    await show(upgrade(SOURCE));
    expect(
      screen.getByText(
        new RegExp(
          `Upgrade the contract ${TARGET}, replacing its code with the code of ${SOURCE}, with the arguments \\(\\)\\. Afterwards it is upgradeable, readable, not payable, not payable by smart contracts`
        )
      )
    ).toBeTruthy();
    expect(screen.getByText(NEW_CODE)).toBeTruthy();
    expect(screen.getByText(OLD_CODE)).toBeTruthy();
    expect(tones()).toEqual([
      "ok: The source is in shard 1, the safe's own shard.",
      'ok: The safe owns the contract, so it may upgrade it.',
      'ok: The metadata stays as it is: upgradeable, readable, not payable, not payable by smart contracts.'
    ]);
  });

  test('a signer can check the source against the release without leaving the page', async () => {
    await show(upgrade(SOURCE));
    const field = screen.getByLabelText('Expected code hash for action 5');
    fireEvent.change(field, { target: { value: NEW_CODE.toUpperCase() } });
    expect(
      screen
        .getByText('Matches the code hash of the source.')
        .getAttribute('data-tone')
    ).toBe('ok');
    fireEvent.change(field, { target: { value: OLD_CODE } });
    expect(screen.getByText(/Does NOT match/).getAttribute('data-tone')).toBe(
      'bad'
    );
  });

  test('a source in another shard is red before anyone signs', async () => {
    await show(upgrade(WRONG_SHARD_SOURCE));
    const line = screen.getByText(
      /The source is in shard 0 and the safe in shard 1/
    );
    expect(line.getAttribute('data-tone')).toBe('bad');
    expect(line.textContent).toMatch(/use the action up/);
  });

  test('metadata without "upgradeable" is red, in the sentence and in the checks', async () => {
    await show(upgrade(SOURCE, Uint8Array.of(0x04, 0x00)));
    expect(
      screen.getByText(/it can never be changed again, by anyone\. Do not sign/)
    ).toBeTruthy();
    expect(
      screen
        .getByText(/After this the contract is NOT upgradeable/)
        .getAttribute('data-tone')
    ).toBe('bad');
  });

  test('a flag that changes is red', async () => {
    await show(upgrade(SOURCE, Uint8Array.of(0x05, 0x02)));
    expect(
      screen
        .getByText(/The metadata changes: the contract becomes payable/)
        .getAttribute('data-tone')
    ).toBe('bad');
  });

  test('an upgradeable source, whose code its owner could swap before the perform, is red', async () => {
    mockAccounts[SOURCE] = contract({
      owner: ALICE,
      hash: NEW_CODE,
      upgradeable: true
    });
    await show(upgrade(SOURCE));
    expect(
      screen.getByText(/The source is upgradeable/).getAttribute('data-tone')
    ).toBe('bad');
  });

  test('a contract the safe does not own is red', async () => {
    mockAccounts[TARGET] = contract({ owner: CAROL, hash: OLD_CODE });
    await show(upgrade(SOURCE));
    expect(
      screen
        .getByText(/The safe does not own this contract/)
        .getAttribute('data-tone')
    ).toBe('bad');
  });

  test('once signed, the performer sees the budget and Carry it out sends exactly it', async () => {
    await show(upgrade(SOURCE), [ALICE, BOB]);
    const gas = screen.getByLabelText('Gas for action 5') as HTMLInputElement;
    expect(gas.value).toBe('25300000');
    expect(
      screen.getByText(
        /7\.5M for the safe, 10\.8M for the upgrade, 7M for the callback: 25\.3M/
      )
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Carry it out'));
    });
    expect(performAction).toHaveBeenCalledWith(
      expect.anything(),
      SAFE,
      5,
      25300000n
    );
  });

  test('the performer can change the figure, and a figure that is not one stops the button', async () => {
    await show(upgrade(SOURCE), [ALICE, BOB]);
    const gas = screen.getByLabelText('Gas for action 5');
    fireEvent.change(gas, { target: { value: 'lots' } });
    expect(
      (screen.getByText('Carry it out') as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.change(gas, { target: { value: '30,000,000' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Carry it out'));
    });
    expect(performAction).toHaveBeenCalledWith(
      expect.anything(),
      SAFE,
      5,
      30000000n
    );
  });
});

describe('a pending call on a contract the safe owns', () => {
  const setFee = {
    kind: 'SendAsyncCall' as const,
    to: TARGET,
    endpoint: 'setFee',
    args: [Uint8Array.from(Buffer.from('2386f26fc10000', 'hex'))]
  };

  test('reads as the call, the amount exactly and as EGLD', async () => {
    await show(setFee);
    expect(
      screen.getByText(
        `Call setFee(10,000,000,000,000,000 [0.01 EGLD at 18 decimals]) on ${TARGET}`
      )
    ).toBeTruthy();
    expect(tones()).toEqual([
      'ok: Tried just now as the safe would send it: it works, and needs 3,800,000 gas.',
      'ok: The safe owns the contract it calls.'
    ]);
  });

  test('its perform gets 7.5M + 1.2 x the need + 7M', async () => {
    await show(setFee, [ALICE, BOB]);
    expect(
      (screen.getByLabelText('Gas for action 5') as HTMLInputElement).value
    ).toBe('19100000');
    await act(async () => {
      fireEvent.click(screen.getByText('Carry it out'));
    });
    expect(performAction).toHaveBeenCalledWith(
      expect.anything(),
      SAFE,
      5,
      19100000n
    );
  });

  test('a call the contract refuses when the safe sends it is red', async () => {
    const { ErrEstimateTransactionCost } = jest.requireActual(
      '@multiversx/sdk-core'
    );
    mockTrial.answer = async () => {
      throw new ErrEstimateTransactionCost(
        'user error: Endpoint can only be called by owner'
      );
    };
    await show(setFee);
    expect(
      screen
        .getByText(
          /the call FAILS: user error: Endpoint can only be called by owner/
        )
        .getAttribute('data-tone')
    ).toBe('bad');
  });

  test('a call that could not be tried says so, and its gas is a default it calls one', async () => {
    const { ErrEstimateTransactionCost } = jest.requireActual(
      '@multiversx/sdk-core'
    );
    mockTrial.answer = async () => {
      throw new ErrEstimateTransactionCost(
        'insufficient balance for fees, has: 0, wanted: 6080684990000000'
      );
    };
    await show(setFee, [ALICE, BOB]);
    expect(
      screen
        .getByText(
          /could not be tried in advance: the network wants the safe to hold/
        )
        .getAttribute('data-tone')
    ).toBe('warn');
    expect(
      (screen.getByLabelText('Gas for action 5') as HTMLInputElement).value
    ).toBe('26500000');
    expect(
      screen.getByText(/from a default because the need could not be measured/)
    ).toBeTruthy();
  });

  test('handing the contract to someone else is said in those words', async () => {
    await show({
      kind: 'SendAsyncCall',
      to: TARGET,
      endpoint: 'ChangeOwnerAddress',
      args: [Address.newFromBech32(CAROL).getPublicKey()]
    });
    expect(
      screen.getByText(
        `Hand the contract ${TARGET} over to ${CAROL}: the safe would no longer own it`
      )
    ).toBeTruthy();
  });
});

describe('on mainnet', () => {
  const network = require('multisig/network');
  afterEach(() => {
    network.networkName = 'devnet';
  });

  test('an upgrade is carried out with 118.5M until one has been measured there, and the card says why', async () => {
    network.networkName = 'mainnet';
    await show(upgrade(SOURCE), [ALICE, BOB]);
    expect(
      (screen.getByLabelText('Gas for action 5') as HTMLInputElement).value
    ).toBe('118500000');
    expect(
      screen.getByText(
        /raised to 118\.5M: on mainnet an upgrade keeps the figure proven on devnet/
      )
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Carry it out'));
    });
    expect(performAction).toHaveBeenCalledWith(
      expect.anything(),
      SAFE,
      5,
      118500000n
    );
  });
});

test('the line under the gas field adds up to the figure in the field', async () => {
  // The first mainnet vote: setFee needed 3,833,535, and the line said 19.1M
  // under a field of 19,200,000.
  mockTrial.answer = async () => ({ gasLimit: 3833535 });
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: [
      {
        id: 5,
        action: {
          kind: 'SendAsyncCall',
          to: TARGET,
          endpoint: 'setFee',
          args: []
        },
        signers: [ALICE, BOB]
      }
    ]
  });
  await renderSafe(SAFE);
  expect(
    (screen.getByLabelText('Gas for action 5') as HTMLInputElement).value
  ).toBe('19200000');
  expect(
    screen.getByText(/4\.6M for the call, 7M for the callback: 19\.2M/)
  ).toBeTruthy();
});
