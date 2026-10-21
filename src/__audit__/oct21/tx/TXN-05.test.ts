// TXN-05: a stale nonce is reported as the network refusing the action.
//
// settleGas (src/multisig/gas.js) treats every ErrEstimateTransactionCost as
// a refusal of the action: GasError.refused = true, and the page then says
// "The network refused it when trying it in advance: <reason>. Nothing was
// sent." The cost endpoint also checks the transaction's nonce against the
// account (devnet, 21 Oct 2026: "lower nonce in transaction: " and "higher
// nonce in transaction: " with txGasUnits 0). That nonce is the app's own
// state, not the action: contextOf falls back to the page's remembered nonce
// when the account read fails, and that nonce is stale as soon as the wallet
// has sent anything elsewhere, or one ahead while a transaction sent from
// this tab waits in the pool. The person is then told the network refuses
// their signature, proposal or perform, with "lower nonce in transaction: "
// as the reason, when the next read would fix it.
//
// Correct behaviour: a nonce complaint from the simulation is a transient
// failure of the app's own bookkeeping (refused = false, "try again"), not a
// refusal of the action.
import { ErrEstimateTransactionCost } from '@multiversx/sdk-core';
import { GasError, settleGas } from 'multisig/gas';
import { buildSign } from 'multisig/legacyCalls';
import { explainWalletFailure } from 'multisig/walletFailure';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
const context = { chainId: 'D', sender: ALICE, nonce: 9, safe: SAFE };

const refusing = (reason: string) => ({
  estimateTransactionCost: async () => {
    throw new ErrEstimateTransactionCost(reason);
  }
});

const failureOf = async (reason: string): Promise<GasError> => {
  const transaction = await buildSign(context, 3);
  try {
    await settleGas(transaction, { provider: refusing(reason) });
  } catch (error) {
    return error as GasError;
  }
  throw new Error('settleGas did not throw');
};

beforeEach(() =>
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
);

describe("TXN-05: the simulation's nonce complaint is not a refusal of the action", () => {
  test.each([
    ['lower nonce in transaction: '],
    ['higher nonce in transaction: ']
  ])('"%s" is reported as transient, to be tried again', async (reason) => {
    const failure = await failureOf(reason);
    expect(failure).toBeInstanceOf(GasError);
    expect(failure.refused).toBe(false);
    const said = explainWalletFailure(failure, 'That');
    expect(said).not.toMatch(/refused/i);
    expect(said).toMatch(/nothing was sent/i);
  });

  test("control: the contract's own answer is a refusal, in its words", async () => {
    const failure = await failureOf('user error: action does not exist');
    expect(failure.refused).toBe(true);
    expect(explainWalletFailure(failure, 'That')).toMatch(
      /refused it when trying it in advance: user error: action does not exist/
    );
  });

  test('control: a network that does not answer is transient', async () => {
    const transaction = await buildSign(context, 3);
    const attempt = settleGas(transaction, {
      provider: {
        estimateTransactionCost: async () => {
          throw new Error(
            'Request error on url [transaction/cost]: [socket hang up]'
          );
        }
      }
    });
    await expect(attempt).rejects.toMatchObject({ refused: false });
  });
});
