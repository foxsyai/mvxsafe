/**
 * @jest-environment node
 *
 * After a transaction to one safe, only that safe's answers are dropped. The
 * whole cache used to be wiped up to five times in the twenty seconds after a
 * transaction, so a list of eight safes re-read everything each time (found
 * in the mainnet test, 7 Oct 2026).
 */
import { cached, forget } from 'multisig/network';

const A = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const B = 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';

test("forgetting one safe re-reads it and keeps every other safe's answers", async () => {
  await cached(`quorum:${A}`, async () => 2);
  await cached(`quorum:${B}`, async () => 2);
  forget(A);
  const readA = jest.fn(async () => 3);
  const readB = jest.fn(async () => 99);
  expect(await cached(`quorum:${A}`, readA)).toBe(3);
  expect(await cached(`quorum:${B}`, readB)).toBe(2);
  expect(readA).toHaveBeenCalledTimes(1);
  expect(readB).not.toHaveBeenCalled();
});

test('an answer asked for before the transaction landed is not kept after forget', async () => {
  let finish!: (value: string) => void;
  const before = cached(`pending:${A}`, () => new Promise<string>((resolve) => (finish = resolve)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  forget(A);
  finish('stale');
  expect(await before).toBe('stale');
  expect(await cached(`pending:${A}`, async () => 'fresh')).toBe('fresh');
});
