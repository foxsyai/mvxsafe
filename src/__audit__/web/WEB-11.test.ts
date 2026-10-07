/**
 * WEB-11: clearCache() empties the cache and the in-flight map, but a request
 * that was already running keeps its `cache.set(key, value)` on completion. If
 * it finishes after the fresh request started by Refresh, its older answer
 * overwrites the fresh one and is served for the next 60 s. Refresh therefore
 * cannot be trusted to leave the cache fresh.
 *
 * Run: cd /home/sebastian/FOXSY/mvxsafe/app && npx jest src/__audit__/web/WEB-11.test.ts
 */
import { cached, clearCache } from 'multisig/network';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test('an answer that arrives after Refresh does not overwrite the fresh one', async () => {
  const slow = deferred<string>();

  // A read is in flight when the visitor presses Refresh.
  const before = cached('quorum:safe', () => slow.promise);
  clearCache();

  // Refresh reads again and gets the fresh answer at once.
  expect(await cached('quorum:safe', async () => 'fresh')).toBe('fresh');

  // Now the old read completes.
  slow.resolve('stale');
  expect(await before).toBe('stale');

  // Whoever reads next must get what Refresh fetched, not the older answer.
  expect(await cached('quorum:safe', async () => 'a third read, not expected')).toBe('fresh');
});
