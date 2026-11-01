/**
 * @jest-environment node
 *
 * Two glitches in the self-call sentences, found by the review of batch B:
 * a dnsRegister with no EGLD spoke of EGLD moving, and a self-call that names no
 * function read "its own , with its own authority".
 */
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);

import { Address } from '@multiversx/sdk-core';
import { describeAction } from 'multisig/describe';
import { inspectAction } from 'multisig/inspect';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';

const utf8 = (text: string) => new TextEncoder().encode(text);
const pk = (address: string) => Address.newFromBech32(address).getPublicKey();
const selfCall = (
  name: string,
  endpoint: string,
  args: Uint8Array[],
  egld: bigint
) => ({
  name,
  fields: [
    {
      to: SAFE,
      egld_amount: egld,
      endpoint_name: utf8(endpoint),
      arguments: args
    }
  ]
});
const dns = [pk(ALICE), utf8('zzzname')];
const ROUTES = ['SendAsyncCall', 'SendTransferExecute'];

beforeEach(() =>
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [] })
);

describe.each(ROUTES)('dnsRegister with no EGLD, by %s', (route) => {
  test('neither the sentence nor the check speaks of EGLD', async () => {
    const action = selfCall(route, 'dnsRegister', dns, 0n);
    expect(await describeAction(action, SAFE)).not.toMatch(/EGLD/);
    const { checks } = await inspectAction(action, SAFE);
    const line = checks.find((check) => /dnsRegister/.test(check.text));
    expect(line?.tone).toBe('bad');
    expect(line?.text).not.toMatch(/EGLD it is given|the safe pays/);
  });

  test('it still names where the call goes', async () => {
    expect(
      await describeAction(selfCall(route, 'dnsRegister', dns, 0n), SAFE)
    ).toContain(ALICE);
  });
});

test('control: with EGLD, the transfer-execute route still says it left the safe', async () => {
  const sentence = await describeAction(
    selfCall('SendTransferExecute', 'dnsRegister', dns, 10n ** 16n),
    SAFE
  );
  expect(sentence).toMatch(/EGLD out of this safe/);
  expect(sentence).toMatch(/the EGLD left the safe/);
});

test('control: with EGLD, the async route still says it stayed', async () => {
  expect(
    await describeAction(
      selfCall('SendAsyncCall', 'dnsRegister', dns, 10n ** 16n),
      SAFE
    )
  ).toMatch(/the EGLD stayed in the safe/);
});

describe('an async self-call that names no function', () => {
  test.each([
    ['with no EGLD', 0n],
    ['with EGLD', 10n ** 16n]
  ])('reads properly %s', async (_what, egld) => {
    const action = selfCall('SendAsyncCall', '', [], egld);
    const { checks } = await inspectAction(action, SAFE);
    const line = checks.find((check) => /safe itself/.test(check.text));
    expect(line?.tone).toBe('bad');
    expect(line?.text).not.toMatch(/own ,|  /);
    expect(line?.text).toMatch(/names no function/);
    const sentence = await describeAction(action, SAFE);
    expect(sentence).not.toMatch(/Call {2}on| ,/);
  });

  test('control: one with a name still names it', async () => {
    const { checks } = await inspectAction(
      selfCall('SendAsyncCall', 'pause', [], 0n),
      SAFE
    );
    expect(
      checks.find((check) => /safe itself/.test(check.text))?.text
    ).toMatch(/the safe calls its own pause, with its own authority/);
  });
});
