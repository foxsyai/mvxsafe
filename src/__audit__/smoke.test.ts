import { toRawAmount, buildSign } from 'multisig/legacyCalls';
import { shortAddress } from 'multisig/reads';
import { isValidSafeAddress } from 'multisig/savedSafes';

test('the harness can import the shipped modules', async () => {
  expect(toRawAmount('1.5', 18)).toBe(1500000000000000000n);
  expect(shortAddress('erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p', 10, 6)).toContain('...');
  expect(isValidSafeAddress('erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p')).toBe(true);
  const tx = await buildSign(
    { chainId: 'D', sender: 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe', nonce: 1, safe: 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p' },
    7
  );
  expect(Buffer.from(tx.data).toString()).toBe('sign@07');
});
