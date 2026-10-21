// TXN-05, found by the review of PR #11 (21 Oct 2026): the nonce exception
// sat in the shared isRefusal, so it also covered the trial of a call AS THE
// SAFE, whose answer the target contract writes. A contract answering "lower
// nonce in transaction" turned a failing trial from a refusal into "the
// network did not answer", and the propose form no longer refused the call.
//
// Correct behaviour: only the nonce of the person's own transaction is the
// app's bookkeeping; a trial as the safe that fails with it is a refusal.
import { ErrEstimateTransactionCost } from '@multiversx/sdk-core';
import { GasError, settleGas, simulateAsSafe } from 'multisig/gas';
import { buildSign } from 'multisig/legacyCalls';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
const TARGET = 'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const refusing = (reason: string) => ({
  estimateTransactionCost: async () => {
    throw new ErrEstimateTransactionCost(reason);
  }
});
const failureOf = async (attempt: Promise<unknown>) =>
  attempt.then(
    () => {
      throw new Error('it did not throw');
    },
    (error) => error as GasError
  );

test("control: the person's own transaction with a nonce complaint is transient (TXN-05)", async () => {
  const transaction = await buildSign(
    { chainId: 'D', sender: ALICE, nonce: 9, safe: SAFE },
    3
  );
  const failure = await failureOf(
    settleGas(transaction, {
      provider: refusing('lower nonce in transaction: ')
    })
  );
  expect(failure.refused).toBe(false);
});

test('a trial as the safe that fails with a nonce complaint is a refusal', async () => {
  const failure = await failureOf(
    simulateAsSafe(refusing('lower nonce in transaction: '), {
      chainId: 'D',
      safe: SAFE,
      to: TARGET,
      data: 'setFee@01'
    })
  );
  expect(failure).toBeInstanceOf(GasError);
  expect(failure.refused).toBe(true);
});
