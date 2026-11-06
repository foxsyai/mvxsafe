/**
 * @jest-environment node
 *
 * A transaction's status changes from one second to the next, so the toast's
 * settler reads it with apiFresh: through the same paced, retried queue as
 * every other read, but never answered from the cache that api() keeps for
 * two minutes.
 */
import { api, apiFresh, gatewayFresh, gatewayUrl } from 'multisig/network';

const PATH = `/transactions/${'ab'.repeat(32)}?fields=txHash,status,results`;

test('apiFresh asks again where api answers from its cache, and api then sees the new answer', async () => {
  const statuses = ['pending', 'success'];
  const fetched = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: statuses.shift() })
  }));
  (globalThis as any).fetch = fetched;

  expect(await api(PATH)).toEqual({ status: 'pending' });
  expect(await api(PATH)).toEqual({ status: 'pending' });
  expect(fetched).toHaveBeenCalledTimes(1);

  expect(await apiFresh(PATH)).toEqual({ status: 'success' });
  expect(fetched).toHaveBeenCalledTimes(2);
  expect(await api(PATH)).toEqual({ status: 'success' });
  expect(fetched).toHaveBeenCalledTimes(2);
});

const STATUS = `/transaction/${'cd'.repeat(32)}/process-status`;
const answer = (status: number, body: unknown) => ({
  ok: status === 200,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body
});

test('gatewayFresh asks the gateway, never from the cache, and takes its 500 for a transaction it does not hold as an answer', async () => {
  const fetched = jest.fn(async (_url: string) =>
    answer(500, {
      data: null,
      error: 'transaction not found',
      code: 'internal_issue'
    })
  );
  (globalThis as any).fetch = fetched;
  await expect(gatewayFresh(STATUS)).rejects.toThrow('answered 500');
  // Not asked again and again: once.
  expect(fetched).toHaveBeenCalledTimes(1);
  expect(fetched.mock.calls[0][0]).toBe(`${gatewayUrl}${STATUS}`);

  fetched.mockImplementation(async () =>
    answer(200, { code: 'successful', data: { status: 'success' } })
  );
  expect(await gatewayFresh(STATUS)).toEqual({
    code: 'successful',
    data: { status: 'success' }
  });
  expect(await gatewayFresh(STATUS)).toBeTruthy();
  expect(fetched).toHaveBeenCalledTimes(3);
});

test('any other 500 from the gateway is asked again', async () => {
  const replies = [
    answer(500, { error: 'upstream timeout' }),
    answer(200, { code: 'successful', data: { status: 'pending' } })
  ];
  const fetched = jest.fn(async () => replies.shift());
  (globalThis as any).fetch = fetched;
  expect(await gatewayFresh(`${STATUS}?again`)).toEqual({
    code: 'successful',
    data: { status: 'pending' }
  });
  expect(fetched).toHaveBeenCalledTimes(2);
});
