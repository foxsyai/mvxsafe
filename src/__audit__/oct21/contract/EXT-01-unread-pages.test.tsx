// EXT-01's gap on the pages (found by the mvxvest side, 23 Oct 2026): with the
// source's code missing from the API's answer, nothing may go ahead on the
// hash the API states. The pending card holds Sign and Carry it out (removing
// a signature stays possible), the upgrade form does not call a pasted
// release hash a match and does not propose, and a deployed source is not
// called "exactly the file's".
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => ({
  ...require('../../display/mocks').actionsMock,
  proposeUpgrade: jest.fn(async () => 'session'),
  deploySource: jest.fn(async () => (globalThis as any).__deployedTo)
}));

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DeploySource } from 'components/Propose/DeploySource';
import { UpgradeForm } from 'components/Propose/UpgradeForm';
import { codeHashOf, predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockCode
} from '../../../multisig/tests/contractsMock';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

const TARGET = predictSafeAddress(CAROL, 40);
const SOURCE = predictSafeAddress(ALICE, 60); // shard 1, the safe's
const NEW_CODE = mockCode('new');
const signer = { address: ALICE, nonce: 1 };

const sourceCodeReturned = (returned: boolean) => {
  const stated = contract({ owner: ALICE, hash: NEW_CODE, upgradeable: false });
  mockAccounts[SOURCE] = returned ? stated : { ...stated, code: undefined };
};

const upgradeSignedBy = (signers: string[]) => {
  connectAs(BOB);
  useChain({
    quorum: 2,
    board: [ALICE, BOB, CAROL],
    roles: { [BOB]: 2 },
    pending: [
      {
        id: 5,
        action: {
          kind: 'SCUpgradeFromSource',
          scAddress: TARGET,
          source: SOURCE,
          codeMetadata: Uint8Array.of(0x05, 0x00)
        },
        signers
      }
    ]
  });
};
const button = (name: string) =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: mockCode('old') });
});

describe('the pending card', () => {
  test('control: the code is returned, so Sign and Carry it out are offered', async () => {
    sourceCodeReturned(true);
    upgradeSignedBy([ALICE]);
    await renderSafe(SAFE);
    expect(button('Sign').disabled).toBe(false);
  });

  test("the source's code is not returned: Sign is held, with the reason", async () => {
    sourceCodeReturned(false);
    upgradeSignedBy([ALICE]);
    await renderSafe(SAFE);
    expect(
      screen.getByText(/did not return the source's code/)
    ).toBeInTheDocument();
    // The card shows no hash for it, rather than the API's word.
    expect(screen.getByText('not read just now (refresh)')).toBeInTheDocument();
    expect(button('Sign').disabled).toBe(true);
  });

  test('with the quorum in, Carry it out is held too, and a signature can still be removed', async () => {
    sourceCodeReturned(false);
    upgradeSignedBy([ALICE, BOB]);
    await renderSafe(SAFE);
    expect(button('Carry it out').disabled).toBe(true);
    expect(button('Remove my signature').disabled).toBe(false);
  });
});

describe('the pending card, the contract to upgrade unread (review of PR #17)', () => {
  const targetCodeUnread = () => {
    mockAccounts[TARGET] = {
      ...contract({ owner: SAFE, hash: mockCode('old') }),
      code: undefined
    };
  };

  test('Sign is held, with the reason', async () => {
    sourceCodeReturned(true);
    targetCodeUnread();
    upgradeSignedBy([ALICE]);
    await renderSafe(SAFE);
    expect(
      screen.getByText(/did not return the code of the contract to upgrade/)
    ).toBeInTheDocument();
    expect(button('Sign').disabled).toBe(true);
  });

  test('with the quorum in, Carry it out is held, and a signature can still be removed', async () => {
    sourceCodeReturned(true);
    targetCodeUnread();
    upgradeSignedBy([ALICE, BOB]);
    await renderSafe(SAFE);
    expect(button('Carry it out').disabled).toBe(true);
    expect(button('Remove my signature').disabled).toBe(false);
  });
});

describe('the upgrade form', () => {
  const type = (placeholder: string, value: string, nth = 0) =>
    fireEvent.change(screen.getAllByPlaceholderText(placeholder)[nth], {
      target: { value }
    });

  test("the release hash pasted is not called a match on the API's word, and nothing is proposed", async () => {
    sourceCodeReturned(false);
    render(<UpgradeForm safe={SAFE} signer={signer} onProposed={jest.fn()} />);
    type('erd1qqqqqqqqqqqqqpgq...', TARGET, 0);
    type('erd1qqqqqqqqqqqqqpgq...', SOURCE, 1);
    type('64 hex characters from the release', NEW_CODE);
    await screen.findByText(
      /did not return the source's code/,
      {},
      { timeout: 3000 }
    );
    expect(
      screen.queryByText('Matches the code hash of the source.')
    ).toBeNull();
    expect(button('Propose').disabled).toBe(true);
  });
});

describe('a source just deployed', () => {
  const wasm = new Uint8Array(
    readFileSync(join(__dirname, '../../../../public/contracts/multisig.wasm'))
  );
  const hash = codeHashOf(wasm);

  test('an answer with its hash but not its code is not "exactly the file\'s"', async () => {
    jest.useFakeTimers();
    try {
      const at = predictSafeAddress(ALICE, 61);
      (globalThis as any).__deployedTo = at;
      mockAccounts[at] = {
        ...contract({ owner: ALICE, hash, upgradeable: false }),
        code: undefined
      };
      render(<DeploySource safe={SAFE} signer={signer} onUse={jest.fn()} />);
      const file = new File([wasm], 'multisig.wasm');
      (file as any).arrayBuffer = async () =>
        wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
      await act(async () => {
        fireEvent.change(
          document.querySelector('input[type=file]') as HTMLInputElement,
          {
            target: { files: [file] }
          }
        );
      });
      fireEvent.change(
        screen.getByPlaceholderText('64 hex characters from the release'),
        {
          target: { value: hash }
        }
      );
      await act(async () => {
        fireEvent.click(button('Deploy the source'));
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
      });
      expect(screen.queryByText(/exactly the file's/)).toBeNull();
      expect(
        screen.getByText(/Reading its code back from the chain/)
      ).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
