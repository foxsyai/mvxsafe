/**
 * @jest-environment node
 *
 * Found in the mainnet test on 7 Oct 2026: a list of eight safes stopped at
 * "Reading 0 of 8". The queue runs six requests at a time, and a few readers
 * wrapped api(), which queues its own request, in a second cached() that also
 * queued. With six of those at once, every slot was held by a request waiting
 * for a slot, and nothing ever moved again.
 */
import { readHerotag } from 'multisig/addressBook';

const addresses = Array.from(
  { length: 10 },
  (_, at) => `erd1qqqqqqqqqqqqqpgq${String(at).padStart(2, '0')}xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p`.slice(0, 62)
);

beforeEach(() => {
  (global as any).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ username: 'someone.elrond' })
  }));
});

test('ten lookups at once all finish: the queue never waits on itself', async () => {
  const all = Promise.all(addresses.map((address) => readHerotag(address)));
  const stuck = new Promise((resolve) => setTimeout(() => resolve('stuck'), 4000));
  const outcome = await Promise.race([all.then(() => 'done'), stuck]);
  expect(outcome).toBe('done');
}, 10000);
