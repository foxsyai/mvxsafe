/**
 * @jest-environment node
 *
 * The twin of the vesting site's VSD-09 (1 Nov 2026): does a simulation that
 * could not run read as the network refusing? Here it does not, and this pins
 * that through the real SDK provider, so the shape of its errors is the real one:
 * sdk-core raises ErrEstimateTransactionCost only for a message from the network,
 * and a failed request as ErrNetworkProvider with the HTTP answer inside.
 */
import { Address, ApiNetworkProvider, Transaction } from '@multiversx/sdk-core';
import axios from 'axios';
import { GasError, settleGas, simulateAsSafe } from 'multisig/gas';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
const provider = new ApiNetworkProvider('https://api.invalid', {
  clientName: 'test'
});

const answered = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: { message } }
  });
const noAnswer = (message: string) =>
  Object.assign(new Error(message), { isAxiosError: true });

const settle = () =>
  settleGas(
    new Transaction({
      sender: Address.newFromBech32(ALICE),
      receiver: Address.newFromBech32(SAFE),
      gasLimit: 0n,
      chainID: '1',
      nonce: 3n
    }),
    { provider }
  );

const transport: [string, () => Error][] = [
  ['a 429', () => answered(429, 'Too many requests')],
  ['a 503', () => answered(503, 'unavailable')],
  ['a 504 whose body reads like a refusal', () => answered(504, 'user error')],
  ['a timeout', () => noAnswer('timeout of 15000ms exceeded')],
  ['a dropped connection', () => noAnswer('Network Error')]
];

afterEach(() => jest.restoreAllMocks());

test.each(transport)(
  '%s is "could not try it", on a send and in a trial as the safe',
  async (_what, error) => {
    jest.spyOn(axios, 'post').mockRejectedValue(error());
    const sent = await settle().catch((failure) => failure);
    expect(sent).toBeInstanceOf(GasError);
    expect(sent.refused).toBe(false);
    expect(sent.message).toMatch(/could not try it/);

    const trial = await simulateAsSafe(provider, {
      chainId: '1',
      safe: SAFE,
      to: ALICE,
      data: 'claim'
    }).catch((failure) => failure);
    expect(trial).toBeInstanceOf(GasError);
    expect(trial.refused).toBe(false);
  }
);

test('control: the network saying no is still a refusal', async () => {
  jest
    .spyOn(axios, 'post')
    .mockRejectedValue(answered(400, 'execution failed: user error'));
  const sent = await settle().catch((failure) => failure);
  expect(sent).toBeInstanceOf(GasError);
  expect(sent.refused).toBe(true);
  expect(sent.message).toMatch(/refused it/);
});

test('control: a nonce complaint on a send is not the action being refused (TXN-05)', async () => {
  jest
    .spyOn(axios, 'post')
    .mockRejectedValue(answered(400, 'lower nonce in transaction'));
  const sent = await settle().catch((failure) => failure);
  expect(sent.refused).toBe(false);
});
