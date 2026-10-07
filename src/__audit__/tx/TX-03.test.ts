// TX-03: a negative token amount becomes a transfer of nothing.
//
// toRawAmount('-1', 18) returns -1000000000000000000n. The EGLD path refuses
// that (BigUIntValue throws on negatives) but the token path hand-encodes the
// amount in amountBytes (legacyCalls.js:80-84): (-1e18).toString(16) is
// "-de0b6b3a7640000", and Buffer.from of that as hex stops at the "-" and
// yields an EMPTY buffer, which is the top-level encoding of zero. The result
// is a well-formed proposeAsyncCall asking the recipient to run
// ESDTTransfer@token@ with no amount at all, which the contract accepts.
// The wallet shows only hex; the proposer has signed a proposal for 0.
import { buildProposeToken, toRawAmount } from 'multisig/legacyCalls';

const ctx = {
  chainId: 'D',
  sender: 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3',
  nonce: 1,
  safe: 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy'
};
const to = 'erd1cus9zpgyg8ztpvr48j8w8lqack3u7gtlnxlum22cdl0k0vfwm3eq54npug';

const attempt = async (amount: string) =>
  buildProposeToken(ctx, { to, tokenIdentifier: 'WEGLD-a28c59', amount, decimals: 18 });

describe('TX-03: a negative token amount is refused, not encoded as zero', () => {
  test.each(['-1', '-0.5', '-1000'])('a token proposal for %s is refused', async (amount) => {
    await expect(attempt(amount)).rejects.toThrow();
  });

  test('toRawAmount refuses a negative amount', () => {
    expect(() => toRawAmount('-1', 18)).toThrow();
  });
});
