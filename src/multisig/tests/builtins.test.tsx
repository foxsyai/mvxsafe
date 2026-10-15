// Built-in functions of the network and its system contracts, named in a call:
// refused by the call form and red on the card, except the ones a safe uses
// every day (tokens leaving it, its own tokens moved, minted or burnt) and the
// harmless ClaimDeveloperRewards. Asked for by mvxvest's audit of the upgrade
// procedure, 14 Oct 2026, after this project's own audit (UPG-01).
jest.mock(
  'multisig/network',
  () => require('./contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({
  proposeCall: jest.fn(async () => 'session')
}));

import '../../__audit__/display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { Address } from '@multiversx/sdk-core';
import { fireEvent, render, screen } from '@testing-library/react';
import { CallForm } from 'components/Propose/CallForm';
import { describeAction } from 'multisig/describe';
import { inspectAction } from 'multisig/inspect';
import {
  buildProposeCall,
  builtInRefusal,
  isSystemContract,
  predictSafeAddress
} from 'multisig/legacyCalls';
import {
  ALICE,
  CAROL,
  ESDT_SYSTEM_SC,
  SAFE
} from '../../__audit__/display/fixtures';
import { contract, mockAccounts, mockTrial } from './contractsMock';

const TARGET = predictSafeAddress(CAROL, 40);
const context = { chainId: 'D', sender: ALICE, nonce: 1, safe: SAFE };
const pk = (bech32: string) => Address.newFromBech32(bech32).getPublicKey();
const call = (to: string, endpoint: string, args: Uint8Array[] = []) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to,
      egld_amount: 0n,
      endpoint_name: Buffer.from(endpoint),
      arguments: args
    }
  ]
});
const red = async (action: any) =>
  (await inspectAction(action, SAFE)).checks.filter(
    (check) => check.tone === 'bad' && !check.advisory
  );

beforeEach(() => {
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: '11'.repeat(32) });
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
});

describe('the call builder', () => {
  test.each([
    'upgradeContract',
    'ChangeOwnerAddress',
    'SetGuardian',
    'GuardAccount',
    'ESDTNFTCreate',
    'ESDTTransfer',
    'SaveKeyValue'
  ])('refuses the built-in %s', async (name) => {
    expect(builtInRefusal(name)).not.toBe('');
    await expect(
      buildProposeCall(context, { to: TARGET, functionName: name })
    ).rejects.toThrow(/built-in|Upgrade a contract/);
  });

  test("lets through ClaimDeveloperRewards and a contract's own functions", async () => {
    await expect(
      buildProposeCall(context, {
        to: TARGET,
        functionName: 'ClaimDeveloperRewards'
      })
    ).resolves.toBeTruthy();
    await expect(
      buildProposeCall(context, {
        to: TARGET,
        functionName: 'setTokenFee',
        args: [{ kind: 'number', value: '10' }]
      })
    ).resolves.toBeTruthy();
  });

  test('tells a system contract from an ordinary one', () => {
    expect(isSystemContract(ESDT_SYSTEM_SC)).toBe(true);
    expect(isSystemContract(TARGET)).toBe(false);
    expect(isSystemContract(SAFE)).toBe(false);
  });
});

describe('the card', () => {
  test('handing an owned contract to a new owner is red', async () => {
    const checks = await red(call(TARGET, 'ChangeOwnerAddress', [pk(CAROL)]));
    expect(checks.map((check) => check.text).join(' ')).toMatch(
      /new owner.*cannot undo this/
    );
  });

  test('any other built-in on a contract is red', async () => {
    const checks = await red(
      call(TARGET, 'SetGuardian', [pk(CAROL), Buffer.from('svc')])
    );
    expect(checks.map((check) => check.text).join(' ')).toMatch(
      /SetGuardian is a built-in function of the network/
    );
  });

  test('a call on a system contract is red', async () => {
    const checks = await red(
      call(ESDT_SYSTEM_SC, 'setSpecialRole', [
        Buffer.from('FOXSY-5d5f3e'),
        pk(ALICE),
        Buffer.from('ESDTRoleLocalMint')
      ])
    );
    expect(checks.map((check) => check.text).join(' ')).toMatch(
      /system contract of the network/
    );
  });

  test('what a safe does every day is not flagged: a token sent, and its own NFT moved', async () => {
    const tokenSent = call(ALICE, 'ESDTTransfer', [
      Buffer.from('WEGLD-a28c59'),
      Uint8Array.of(1)
    ]);
    const nftMoved = call(SAFE, 'ESDTNFTTransfer', [
      Buffer.from('LKMEX-aab910'),
      Uint8Array.of(1),
      Uint8Array.of(1),
      pk(ALICE)
    ]);
    expect(await red(tokenSent)).toEqual([]);
    expect(await red(nftMoved)).toEqual([]);
  });

  test('ClaimDeveloperRewards is said in words, and not flagged', async () => {
    expect(
      await describeAction(call(TARGET, 'ClaimDeveloperRewards'), SAFE)
    ).toBe(
      `Collect the developer rewards of the contract ${TARGET} into its owner`
    );
    expect(await red(call(TARGET, 'ClaimDeveloperRewards'))).toEqual([]);
  });
});

describe('the call form', () => {
  const fill = (to: string, name: string) => {
    render(
      <CallForm
        safe={SAFE}
        signer={{ address: ALICE, nonce: 1 }}
        onProposed={jest.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('erd1qqqqqqqqqqqqqpgq...'), {
      target: { value: to }
    });
    fireEvent.change(screen.getByPlaceholderText('setFee'), {
      target: { value: name }
    });
  };

  test('refuses a built-in, and says how to do it instead', async () => {
    fill(TARGET, 'ChangeOwnerAddress');
    expect(
      screen.getByText(
        /ChangeOwnerAddress is a built-in function of the network/
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Propose' })).toBeDisabled();
  });

  test('says in red that a system contract is one', () => {
    fill(ESDT_SYSTEM_SC, 'setSpecialRole');
    expect(
      screen.getByText(/This is a system contract of the network/)
    ).toHaveAttribute('data-tone', 'bad');
  });
});
