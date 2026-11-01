// FND-03 on the page and in the form (fix phase, 1 Nov 2026): junk tokens do not
// push the real one off the tile, the list or the Send form, and a read that
// stops at its limit says so.
jest.mock('multisig/network', () => {
  const { networkMock } = require('../../display/fixtures');
  const scene: any = ((globalThis as any).__tokens = { all: [], counted: 0 });
  return {
    ...networkMock,
    api: async (path: string) => {
      const tokens = /^\/accounts\/[^/]+\/tokens(\/count)?(\?(.*))?$/.exec(
        path
      );
      if (tokens) {
        if (tokens[1]) {
          if (scene.countFails) throw new Error('answered 503');
          return scene.counted || scene.all.length;
        }
        const params = new URLSearchParams(tokens[3] ?? '');
        const from = Number(params.get('from') ?? 0);
        const size = Number(params.get('size') ?? 25);
        scene.pages = (scene.pages ?? 0) + 1;
        return scene.all.slice(from, from + size);
      }
      return networkMock.api(path);
    }
  };
});
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ProposePanel } from 'components/Propose/ProposePanel';
import {
  featuredToken,
  MAX_TOKENS,
  readBalances,
  TokenBalance
} from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain } from '../../display/fixtures';
import { connectAs, renderSafe } from '../../display/renderSafe';

const scene = () => (globalThis as any).__tokens;
const junk = (count: number) =>
  Array.from({ length: count }, (_, at) => ({
    identifier: `AAA${at.toString(36).toUpperCase().padStart(3, '0')}-${at.toString(16).padStart(6, '0')}`,
    balance: '1',
    decimals: 0
  }));
const real = {
  identifier: 'TOKEN-abc123',
  balance: '5000000000000000000',
  decimals: 18,
  valueUsd: 1000
};
const unpriced = (identifier: string): TokenBalance => ({
  identifier,
  ticker: identifier,
  name: identifier,
  balance: '1',
  decimals: 0,
  amount: 1
});

beforeEach(() => {
  scene().all = [];
  scene().counted = 0;
  scene().countFails = false;
  scene().pages = 0;
});

test('the valued token leads, wherever the API sorted it', async () => {
  scene().all = [...junk(120), real];
  const { tokens, tokensNotRead } = await readBalances(SAFE);
  expect(tokens[0].identifier).toBe('TOKEN-abc123');
  expect(tokens).toHaveLength(121);
  expect(tokensNotRead).toBe(0);
});

test('one short page costs one read', async () => {
  scene().all = [real];
  await readBalances(SAFE);
  expect(scene().pages).toBe(1);
});

test('more than the limit: read up to it, and the rest counted', async () => {
  scene().all = junk(MAX_TOKENS + 50);
  const { tokens, tokensNotRead } = await readBalances(SAFE);
  expect(tokens).toHaveLength(MAX_TOKENS);
  expect(tokensNotRead).toBe(50);
});

test('more than the limit and no count: unknown, not none', async () => {
  scene().all = junk(MAX_TOKENS + 50);
  scene().countFails = true;
  const { tokensNotRead } = await readBalances(SAFE);
  expect(tokensNotRead).toBeNull();
});

test('exactly the limit: the count says there is nothing more', async () => {
  scene().all = junk(MAX_TOKENS);
  const { tokensNotRead } = await readBalances(SAFE);
  expect(tokensNotRead).toBe(0);
});

test('with no price anywhere, junk does not take the tile: whoever sorts first chose their own name', () => {
  expect(
    featuredToken([unpriced('AAA-000001'), unpriced('TOKEN-abc123')])
  ).toBeUndefined();
  expect(featuredToken([unpriced('TOKEN-abc123')])?.identifier).toBe(
    'TOKEN-abc123'
  );
});

const openSafe = async () => {
  connectAs(BOB);
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [] });
  return renderSafe(SAFE);
};

test('the page: the real token on the tile and on top of a short holdings list', async () => {
  scene().all = [...junk(60), real];
  await openSafe();
  const rows = () =>
    within(screen.getByRole('heading', { name: /^Holdings/ }).parentElement!)
      .getAllByRole('listitem')
      .map((row) => row.textContent);
  expect(rows()[1]).toMatch(/^TOKEN-abc123/);
  expect(rows().length).toBeLessThan(30);
  fireEvent.click(screen.getByRole('button', { name: /Show all 61 tokens/ }));
  expect(rows().length).toBeGreaterThan(60);
});

test('the page says when it stopped reading tokens', async () => {
  scene().all = junk(MAX_TOKENS + 50);
  await openSafe();
  expect(screen.getByText(/50 more tokens were not read/).textContent).toMatch(
    /1,000/
  );
});

test('the Send form offers every token read, with a search box when there are many', () => {
  const tokens = [
    ...junk(60).map((token) => unpriced(token.identifier)),
    unpriced('TOKEN-abc123')
  ];
  render(
    <ProposePanel
      safe={SAFE}
      signer={{ address: BOB, nonce: 1 }}
      tokens={tokens}
      boardSize={3}
      boardMembers={[ALICE, BOB, CAROL]}
      proposers={[]}
      quorum={2}
      onProposed={jest.fn()}
    />
  );
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  expect(select.options).toHaveLength(61);
  fireEvent.change(screen.getByPlaceholderText(/Search the 61 tokens/), {
    target: { value: 'token-abc' }
  });
  const offered = Array.from(select.options).map((option) => option.value);
  expect(offered).toContain('TOKEN-abc123');
  expect(offered.length).toBeLessThanOrEqual(2);
});

const sendForm = (tokensNotRead?: number | null) =>
  render(
    <ProposePanel
      safe={SAFE}
      signer={{ address: BOB, nonce: 1 }}
      tokens={junk(MAX_TOKENS).map((token) => unpriced(token.identifier))}
      tokensNotRead={tokensNotRead}
      boardSize={3}
      boardMembers={[ALICE, BOB, CAROL]}
      proposers={[]}
      quorum={2}
      onProposed={jest.fn()}
    />
  );

test('tokens capped: the Send form says so, with the count', () => {
  sendForm(50);
  expect(screen.getByText(/50 more tokens were not read/).textContent).toMatch(
    /first 1,000/
  );
});

test('tokens capped and no count: the Send form says that too', () => {
  sendForm(null);
  expect(screen.getByText(/did not say how many more/)).toBeTruthy();
});

test('control: nothing left unread, no such line', () => {
  sendForm(0);
  expect(screen.queryByText(/were read/)).toBeNull();
});

test('the line goes with the token choice: other forms do not carry it', () => {
  sendForm(50);
  fireEvent.click(screen.getByRole('button', { name: 'Send EGLD' }));
  expect(screen.queryByText(/50 more tokens were not read/)).toBeNull();
});

test('control: a few tokens need no search box', () => {
  render(
    <ProposePanel
      safe={SAFE}
      signer={{ address: BOB, nonce: 1 }}
      tokens={[unpriced('TOKEN-abc123')]}
      boardSize={3}
      boardMembers={[ALICE, BOB, CAROL]}
      proposers={[]}
      quorum={2}
      onProposed={jest.fn()}
    />
  );
  expect(screen.queryByPlaceholderText(/Search/)).toBeNull();
});
