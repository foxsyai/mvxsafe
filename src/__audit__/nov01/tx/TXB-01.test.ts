/**
 * @jest-environment node
 */
// TXB-01: a call to a system contract whose need could not be measured is
// given a perform budget that runs out, and the action is used up with every
// signature on it.
//
// A call to the ESDT system contract (controlChanges, setSpecialRole, pause,
// transferOwnership...) costs about 50M gas where it runs: on devnet 62M for
// the whole perform failed and 65M worked, and the vote performed with the
// app's unmeasured default of 26.5M failed with "not enough gas" and the action
// was gone (30 Oct 2026). The trial as the safe cannot run when the safe holds
// no EGLD (the usual state right after a deploy), when the API does not answer,
// or when the network cannot run it in its shard. In each case inspectCall
// falls back to UNKNOWN_CALL_NEED (10M), which is sized for a contract the
// safe owns, and the card offers 26.5M as the gas.
//
// Correct behaviour: a perform of a call to a system contract is never offered
// a budget below what such a call needs, about 64M, whether or not the trial
// could run.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import { inspectAction } from 'multisig/inspect';
import { mockTrial } from '../../../multisig/tests/contractsMock';
import { ESDT_SYSTEM_SC, SAFE } from '../../display/fixtures';

// 62M failed and 65M worked on devnet for the whole perform; the floor is the
// safe's own part, the callback lock the network takes and the call's 50.1M.
const FLOOR = 64_000_000n;
const text = (value: string) => Buffer.from(value);
const call = (endpoint: string, args: string[]) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to: ESDT_SYSTEM_SC,
      egld_amount: 0n,
      endpoint_name: text(endpoint),
      arguments: args.map(text)
    }
  ]
});
const budgetOf = async (action: any) => {
  const plan: any = (await inspectAction(action, SAFE)).perform;
  expect(plan.simulate).toBe(false);
  return plan.gasLimit as bigint;
};

const trialCannotRun: [string, () => Promise<{ gasLimit: number }>][] = [
  [
    'the safe holds no EGLD for the trial',
    async () => {
      throw new Error('insufficient balance for fees');
    }
  ],
  [
    'the API does not answer',
    async () => {
      throw new Error('Request failed with status code 429');
    }
  ],
  [
    'the network cannot run it in its shard',
    async () => ({ gasLimit: 600000000 })
  ]
];

test('control: when the trial runs, the budget covers the call', async () => {
  mockTrial.answer = async () => ({ gasLimit: 50_200_000 });
  const budget = await budgetOf(
    call('controlChanges', ['TOKEN-abc123', 'canUpgrade', 'false'])
  );
  expect(budget).toBeGreaterThanOrEqual(FLOOR);
});

test.each(trialCannotRun)(
  'a controlChanges on the ESDT system contract when %s is given enough gas',
  async (_why, answer) => {
    mockTrial.answer = answer;
    const budget = await budgetOf(
      call('controlChanges', ['TOKEN-abc123', 'canUpgrade', 'false'])
    );
    expect(budget).toBeGreaterThanOrEqual(FLOOR);
  }
);

test.each(['setSpecialRole', 'pause', 'transferOwnership', 'unSetSpecialRole'])(
  'the same for %s when the safe holds no EGLD',
  async (endpoint) => {
    mockTrial.answer = async () => {
      throw new Error('insufficient balance for fees');
    };
    const budget = await budgetOf(call(endpoint, ['TOKEN-abc123']));
    expect(budget).toBeGreaterThanOrEqual(FLOOR);
  }
);
