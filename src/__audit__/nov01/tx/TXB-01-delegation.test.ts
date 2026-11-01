/**
 * @jest-environment node
 *
 * Review of PR #20: TXB-01's 50.5M need and 65M floor were proven for the ESDT
 * system contract, and were applied to every system contract, delegation
 * contracts included, where nothing shows they are true: a performer could not go
 * lower, and paid the whole of about 75M. Those keep what they had before it.
 */
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import { Address } from '@multiversx/sdk-core';
import { performGas } from 'components/Pending/ActionChecks';
import { inspectAction } from 'multisig/inspect';
import { isSystemContract } from 'multisig/legacyCalls';
import { mockTrial } from '../../../multisig/tests/contractsMock';
import { ESDT_SYSTEM_SC, SAFE, utf8 } from '../../display/fixtures';

// A delegation contract's shape: a system contract, not the ESDT one.
const DELEGATION = new Address(
  Uint8Array.from(
    Buffer.from(
      `00000000000000000001${'00'.repeat(19)}2bffff`.padEnd(64, '0'),
      'hex'
    )
  )
).toBech32();

const call = (to: string, endpoint: string) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to,
      egld_amount: 0n,
      endpoint_name: utf8(endpoint),
      arguments: []
    }
  ]
});
const offline = () => {
  mockTrial.answer = async () => {
    throw new Error('Request failed with status code 503');
  };
};

test('the address is what it claims to be', () => {
  expect(isSystemContract(DELEGATION)).toBe(true);
  expect(DELEGATION).not.toBe(ESDT_SYSTEM_SC);
});

describe('a delegation contract, not tried', () => {
  beforeEach(offline);

  test('keeps the ordinary default, with no need stated and no floor of 65M', async () => {
    const { checks, perform } = await inspectAction(
      call(DELEGATION, 'claimRewards'),
      SAFE
    );
    expect(Number((perform as any).gasLimit)).toBe(26_500_000);
    expect((perform as any).systemCall).toBeUndefined();
    expect(checks.some((check) => /needs about/.test(check.text))).toBe(false);
    expect(Number(performGas(perform, '20000000').budget)).toBe(20_000_000);
  });

  test('the red line of a system contract stays', async () => {
    const { checks } = await inspectAction(
      call(DELEGATION, 'claimRewards'),
      SAFE
    );
    expect(
      checks.some(
        (check) => check.tone === 'bad' && /system contract/i.test(check.text)
      )
    ).toBe(true);
  });
});

test('a delegation contract, tried: the figure measured, and no floor from it', async () => {
  mockTrial.answer = async () => ({ gasLimit: 6000000 });
  const { perform } = await inspectAction(
    call(DELEGATION, 'claimRewards'),
    SAFE
  );
  expect((perform as any).known).toBe(true);
  expect((perform as any).floor === undefined).toBe(true);
});

test('control: the ESDT system contract keeps the need and the floor TXB-01 proved', async () => {
  offline();
  const { checks, perform } = await inspectAction(
    call(ESDT_SYSTEM_SC, 'pause'),
    SAFE
  );
  expect(Number((perform as any).gasLimit)).toBe(75_100_000);
  expect(checks.some((check) => /needs about/.test(check.text))).toBe(true);
  expect(performGas(perform, '26500000').budget === undefined).toBe(true);
});
