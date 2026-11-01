// What TXB-01 does not pin: the floor is refused and not left to the performer,
// the card says whose default it is, an ordinary call keeps its own rule, and a
// trial with no answer is not remembered. The cache is the real one here.
jest.mock('multisig/network', () => {
  const actual = jest.requireActual('multisig/network');
  return {
    ...actual,
    networkProvider: {
      estimateTransactionCost: (transaction: unknown) =>
        (globalThis as any).__trial(transaction)
    }
  };
});

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ActionChecks, performGas } from 'components/Pending/ActionChecks';
import { performPlan, SYSTEM_CALL_NEED } from 'multisig/gas';
import { trialAsSafe } from 'multisig/inspect';
import { clearCache } from 'multisig/network';
import { ESDT_SYSTEM_SC, SAFE } from '../../display/fixtures';

const plan = performPlan({
  name: 'SendAsyncCall',
  callNeed: null,
  systemCall: true
}) as any;

test('the unmeasured budget of a system contract call covers the call, about 75M', () => {
  expect(SYSTEM_CALL_NEED).toBe(50_500_000n);
  expect(plan.known).toBe(false);
  expect(plan.gasLimit).toBe(75_100_000n);
});

test('a typed figure under what the call needs is refused, with the reason', () => {
  const low = performGas(plan, '26500000');
  expect(low.budget).toBeUndefined();
  expect(low.problem).toMatch(/system contract.*use the action up/);
  expect(performGas(plan, '64999999').budget).toBeUndefined();
  expect(performGas(plan, '65000000').budget).toBe(65_000_000n);
  expect(performGas(plan, undefined).budget).toBe(75_100_000n);
});

test('a measured system contract call has its floor from the measurement', () => {
  const measured = performPlan({
    name: 'SendAsyncCall',
    callNeed: 50_261_501n,
    systemCall: true
  }) as any;
  expect(measured.known).toBe(true);
  expect(measured.floor).toBe(64_761_501n);
  expect(performGas(measured, '64000000').budget).toBeUndefined();
});

test('control: an ordinary call keeps its default, and its own floor', () => {
  const ordinary = performPlan({
    name: 'SendAsyncCall',
    callNeed: null
  }) as any;
  expect(ordinary.gasLimit).toBe(26_500_000n);
  expect(ordinary.floor).toBeUndefined();
  expect(performGas(ordinary, '14500000').budget).toBe(14_500_000n);
});

test('the gas field says whose default it is', () => {
  render(
    <ActionChecks
      action={
        {
          actionId: 1,
          name: 'SendAsyncCall',
          description: '',
          perform: plan,
          signerCount: 0,
          signers: [],
          formerSigners: [],
          quorumReached: true
        } as any
      }
      showGas
      gasText='1000000000'
      onGasText={jest.fn()}
    />
  );
  expect(screen.getByText(/the system contract's default/)).toBeInTheDocument();
});

describe('what the trial remembers', () => {
  const data = 'pause@544f4b454e2d616263313233';
  const trial = () => trialAsSafe(SAFE, ESDT_SYSTEM_SC, 0n, data);
  beforeEach(() => clearCache());

  test('no answer is not kept: the next read asks again', async () => {
    (globalThis as any).__trial = async () => {
      throw new Error('Request failed with status code 429');
    };
    expect((await trial()).how).toBe('offline');
    (globalThis as any).__trial = async () => ({ gasLimit: 50_261_501 });
    expect(await trial()).toEqual({ need: 50_261_501n, how: 'tried' });
  });

  test('control: a real answer is kept', async () => {
    const answer = jest.fn(async () => ({ gasLimit: 50_261_501 }));
    (globalThis as any).__trial = answer;
    await trial();
    await trial();
    expect(answer).toHaveBeenCalledTimes(1);
  });
});
