// The propose forms for an upgrade, a source deploy and a call: what is
// refused or shown in red before anything reaches a wallet, and what is sent
// when it is not.
jest.mock(
  'multisig/network',
  () => require('./contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({
  proposeUpgrade: jest.fn(async () => 'session'),
  proposeCall: jest.fn(async () => 'session'),
  deploySource: jest.fn(async () => (globalThis as any).__deployedTo)
}));

import '../../__audit__/display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CallForm } from 'components/Propose/CallForm';
import { DeploySource } from 'components/Propose/DeploySource';
import { UpgradeForm } from 'components/Propose/UpgradeForm';
import { deploySource, proposeCall, proposeUpgrade } from 'multisig/actions';
import { codeHashOf, predictSafeAddress } from 'multisig/legacyCalls';
import { ALICE, CAROL, SAFE } from '../../__audit__/display/fixtures';
import { contract, mockAccounts, mockTrial } from './contractsMock';

const TARGET = predictSafeAddress(CAROL, 40); // shard 0
const SOURCE = predictSafeAddress(ALICE, 60); // shard 1, the safe's
const WRONG_SHARD_SOURCE = predictSafeAddress(CAROL, 41); // shard 0
const NEW_CODE =
  'fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32';
const OLD_CODE = '11'.repeat(32);
const signer = { address: ALICE, nonce: 1 };

beforeEach(() => {
  jest.clearAllMocks();
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
});

const type = (placeholder: string | RegExp, value: string, nth = 0) =>
  fireEvent.change(screen.getAllByPlaceholderText(placeholder)[nth], {
    target: { value }
  });

const propose = () => screen.getByRole('button', { name: 'Propose' });

describe('proposing an upgrade', () => {
  const fill = async (source: string, expected: string) => {
    render(<UpgradeForm safe={SAFE} signer={signer} onProposed={jest.fn()} />);
    type('erd1qqqqqqqqqqqqqpgq...', TARGET, 0);
    type('erd1qqqqqqqqqqqqqpgq...', source, 1);
    type('64 hex characters from the release', expected);
    // The checks are read a moment after the typing stops.
    await screen.findByText(
      'What the signers will be shown:',
      {},
      { timeout: 3000 }
    );
  };

  test("control: the release hash, a source in the safe's shard, unchanged metadata: proposed as typed", async () => {
    await fill(SOURCE, NEW_CODE);
    expect(
      screen.getByText('Matches the code hash of the source.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Carrying it out will be given 25\.3M gas/)
    ).toBeInTheDocument();
    expect(propose()).toBeEnabled();
    await act(async () => {
      fireEvent.click(propose());
    });
    expect(proposeUpgrade).toHaveBeenCalledWith(signer, SAFE, {
      target: TARGET,
      source: SOURCE,
      metadata: {
        upgradeable: true,
        readable: true,
        payable: false,
        payableBySc: false
      },
      args: []
    });
  });

  test('a source in another shard is red, and refused', async () => {
    await fill(WRONG_SHARD_SOURCE, NEW_CODE);
    expect(
      screen.getByText(/The source is in shard 0 and the safe in shard 1/)
    ).toHaveAttribute('data-tone', 'bad');
    expect(propose()).toBeDisabled();
  });

  test('turning "upgradeable" off is red, and refused even with the right hash', async () => {
    await fill(SOURCE, NEW_CODE);
    expect(propose()).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Upgradeable/ }));
    expect(
      await screen.findByText(
        /After this the contract is NOT upgradeable/,
        {},
        { timeout: 3000 }
      )
    ).toHaveAttribute('data-tone', 'bad');
    expect(propose()).toBeDisabled();
  });

  test("a hash that is not the source's is red, and refused", async () => {
    await fill(SOURCE, OLD_CODE);
    expect(screen.getByText(/Does NOT match/)).toHaveAttribute(
      'data-tone',
      'bad'
    );
    expect(propose()).toBeDisabled();
  });

  test('without the release hash nothing is proposed', async () => {
    await fill(SOURCE, '');
    expect(propose()).toBeDisabled();
    expect(
      screen.getByText(/Paste the release's code hash to propose/)
    ).toBeInTheDocument();
  });

  test("the metadata starts as the contract's today, and a change is red but allowed", async () => {
    mockAccounts[TARGET] = contract({
      owner: SAFE,
      hash: OLD_CODE,
      payable: true
    });
    await fill(SOURCE, NEW_CODE);
    const payable = screen.getByLabelText(/^Payable\. Accepts EGLD sent/);
    expect(payable).toBeChecked();
    fireEvent.click(payable);
    expect(
      await screen.findByText(
        /The metadata changes: the contract stops being payable/,
        {},
        { timeout: 3000 }
      )
    ).toHaveAttribute('data-tone', 'bad');
    expect(propose()).toBeEnabled();
  });
});

describe('deploying a source', () => {
  const wasm = new Uint8Array(
    readFileSync(join(__dirname, '../../../public/contracts/multisig.wasm'))
  );
  const hash = codeHashOf(wasm);
  const pick = async () => {
    const file = new File([wasm], 'multisig.wasm');
    // jsdom's File has no arrayBuffer().
    (file as any).arrayBuffer = async () =>
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
    await act(async () => {
      fireEvent.change(
        document.querySelector('input[type=file]') as HTMLInputElement,
        { target: { files: [file] } }
      );
    });
  };

  test('from a wallet in another shard than the safe: red, and not deployed', async () => {
    render(
      <DeploySource
        safe={SAFE}
        signer={{ address: CAROL, nonce: 1 }}
        onUse={jest.fn()}
      />
    );
    expect(screen.getByText(/Your wallet is in shard 0/)).toHaveAttribute(
      'data-tone',
      'bad'
    );
    await pick();
    type('64 hex characters from the release', hash);
    expect(
      screen.getByRole('button', { name: 'Deploy the source' })
    ).toBeDisabled();
  });

  test("the file's blake2b hash is shown, and a different expected hash stops the deploy", async () => {
    render(<DeploySource safe={SAFE} signer={signer} onUse={jest.fn()} />);
    await pick();
    expect(screen.getByText(hash)).toBeInTheDocument();
    type('64 hex characters from the release', OLD_CODE);
    expect(screen.getByText(/Does NOT match/)).toHaveAttribute(
      'data-tone',
      'bad'
    );
    expect(
      screen.getByRole('button', { name: 'Deploy the source' })
    ).toBeDisabled();
  });

  test('deployed, its code is read back and compared, then offered as the source', async () => {
    const at = predictSafeAddress(ALICE, 61);
    (globalThis as any).__deployedTo = at;
    mockAccounts[at] = contract({ owner: ALICE, hash, upgradeable: false });
    const onUse = jest.fn();
    render(<DeploySource safe={SAFE} signer={signer} onUse={onUse} />);
    await pick();
    type('64 hex characters from the release', hash);
    // The panel's field checks the FILE, and says so.
    expect(
      screen.getByText('Matches the code hash of the file.')
    ).toHaveAttribute('data-tone', 'ok');
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Deploy the source' })
      );
    });
    expect(deploySource).toHaveBeenCalledWith(signer, wasm);
    expect(
      await screen.findByText(/exactly the file's/, {}, { timeout: 6000 })
    ).toHaveAttribute('data-tone', 'ok');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Propose the upgrade with this source'
      })
    );
    expect(onUse).toHaveBeenCalledWith(at);
  });
});

describe('proposing a call', () => {
  const fill = async () => {
    render(<CallForm safe={SAFE} signer={signer} onProposed={jest.fn()} />);
    type('erd1qqqqqqqqqqqqqpgq...', TARGET);
    type('setFee', 'setFee');
    fireEvent.click(screen.getByText('+ add an argument'));
    fireEvent.change(screen.getByLabelText('Kind of argument'), {
      target: { value: 'egld' }
    });
    fireEvent.change(screen.getByLabelText('Argument 1'), {
      target: { value: '0.01' }
    });
  };

  test("the signers' sentence and the bytes are shown, the call is tried as the safe, then proposed", async () => {
    await fill();
    expect(
      await screen.findByText(
        `Call setFee(10,000,000,000,000,000 [0.01 EGLD at 18 decimals]) on ${TARGET}`,
        {},
        { timeout: 3000 }
      )
    ).toBeInTheDocument();
    expect(screen.getByText('setFee@2386f26fc10000')).toBeInTheDocument();
    expect(
      await screen.findByText(/it works and needs 3,800,000 gas/)
    ).toHaveAttribute('data-tone', 'ok');
    expect(
      screen.getByText('The safe owns this contract.')
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(propose());
    });
    expect(proposeCall).toHaveBeenCalledWith(signer, SAFE, {
      to: TARGET,
      egld: '0',
      functionName: 'setFee',
      args: [{ kind: 'egld', value: '0.01' }]
    });
  });

  test('a call the contract refuses when the safe sends it is never proposed', async () => {
    const { ErrEstimateTransactionCost } = jest.requireActual(
      '@multiversx/sdk-core'
    );
    mockTrial.answer = async () => {
      throw new ErrEstimateTransactionCost('user error: fee above the maximum');
    };
    await fill();
    expect(
      await screen.findByText(
        /the call FAILS: user error: fee above the maximum/,
        {},
        { timeout: 3000 }
      )
    ).toHaveAttribute('data-tone', 'bad');
    expect(propose()).toBeDisabled();
  });

  test('an ABI lists the functions that change something, owner-only first, and an enum as its variants', async () => {
    render(<CallForm safe={SAFE} signer={signer} onProposed={jest.fn()} />);
    const abi = JSON.stringify({
      name: 'Vest',
      endpoints: [
        {
          name: 'getFee',
          mutability: 'readonly',
          inputs: [],
          outputs: [{ type: 'BigUint' }]
        },
        { name: 'claim', mutability: 'mutable', inputs: [] },
        {
          name: 'setFee',
          onlyOwner: true,
          mutability: 'mutable',
          inputs: [{ name: 'fee_per_vesting', type: 'BigUint' }]
        },
        {
          name: 'setKeyDisplay',
          onlyOwner: true,
          mutability: 'mutable',
          inputs: [
            { name: 'kind', type: 'KeyKind' },
            { name: 'metadata', type: 'bytes' },
            { name: 'uris', type: 'variadic<bytes>', multi_arg: true }
          ]
        }
      ],
      types: {
        KeyKind: {
          type: 'enum',
          variants: [
            { name: 'Claim', discriminant: 0 },
            { name: 'Cancel', discriminant: 1 }
          ]
        }
      }
    });
    const file = new File([abi], 'vest.abi.json');
    (file as any).text = async () => abi;
    await act(async () => {
      fireEvent.change(
        document.querySelector('input[type=file]') as HTMLInputElement,
        { target: { files: [file] } }
      );
    });
    const functions = Array.from(
      screen.getByDisplayValue('setFee (owner only)').querySelectorAll('option')
    ).map((option) => option.textContent);
    expect(functions).toEqual([
      'setFee (owner only)',
      'setKeyDisplay (owner only)',
      'claim'
    ]);
    fireEvent.change(screen.getByDisplayValue('setFee (owner only)'), {
      target: { value: 'setKeyDisplay' }
    });
    const kinds = Array.from(
      screen.getByLabelText('Value of kind').querySelectorAll('option')
    ).map((o) => o.textContent);
    expect(kinds).toEqual(['Claim (0)', 'Cancel (1)']);
    expect(screen.getByText('+ add a uris')).toBeInTheDocument();
  });
});

test('a function called without its arguments says where they go', async () => {
  const { ErrEstimateTransactionCost } = jest.requireActual(
    '@multiversx/sdk-core'
  );
  mockTrial.answer = async () => {
    throw new ErrEstimateTransactionCost(
      'user error: wrong number of arguments'
    );
  };
  render(<CallForm safe={SAFE} signer={signer} onProposed={jest.fn()} />);
  type('erd1qqqqqqqqqqqqqpgq...', TARGET);
  type('setFee', 'setFee');
  type('0', '0');
  expect(
    await screen.findByText(
      /setFee expects arguments: add them under Arguments\. EGLD paid with the call is a payment, not an argument\./,
      {},
      { timeout: 3000 }
    )
  ).toBeInTheDocument();
  expect(propose()).toBeDisabled();
});
