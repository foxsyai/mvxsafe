// The flood fix on the page (fix phase of the 1 Nov 2026 audit): cards before
// checks, newest first, a page at a time, and never an implication that the
// list is complete. A pending action that was not read must not look as if it
// does not exist; a card's Sign waits for its checks; a failed check stays.
jest.mock(
  'multisig/network',
  () => require('../redteam/RED-03.mock').networkMock
);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);
jest.mock('multisig/reads', () => {
  const actual = jest.requireActual('multisig/reads');
  return { ...actual, readCardChecks: jest.fn(actual.readCardChecks) };
});

import '../../display/restoreSetImmediate';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MULTISIG_CODE_HASH } from 'multisig/legacyCalls';
import { PENDING_PAGE, readCardChecks } from 'multisig/reads';
import { Safe } from 'pages/Safe/Safe';
import { connectAs } from '../../display/mocks';
import { BOB, configure, networkMock, SAFE } from '../redteam/RED-03.mock';

jest.setTimeout(60000);

const realChecks = jest.requireActual('multisig/reads').readCardChecks;
const baseApi = networkMock.api;

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/safe/${SAFE}`]}>
      <Routes>
        <Route path='/safe/:address' element={<Safe />} />
      </Routes>
    </MemoryRouter>
  );

const button = (name: string) =>
  screen.getAllByRole('button', { name })[0] as HTMLButtonElement;
const cardIds = () =>
  screen
    .getAllByText(/^#\d+$/)
    .map((node) => Number(node.textContent!.slice(1)));
const statementOf = () => screen.queryByText(/This list is not complete/);

beforeEach(() => {
  connectAs(BOB);
  window.localStorage.clear();
  window.sessionStorage.clear();
  (readCardChecks as jest.Mock).mockReset().mockImplementation(realChecks);
  // The safe itself runs the multisig: nothing here is held for its identity.
  (networkMock as any).api = (path: string) =>
    path === `/accounts/${SAFE}`
      ? Promise.resolve({
          balance: '0',
          ownerAddress: SAFE,
          codeHash: MULTISIG_CODE_HASH
        })
      : baseApi(path);
});

afterEach(() => {
  (networkMock as any).api = baseApi;
});

test('a poison and a flood: the newest cards first, the count honest, older ones on request', async () => {
  configure({ count: 150, bulkFails: true });
  renderPage();
  await screen.findByText('#150', {}, { timeout: 20000 });
  await waitFor(() => expect(cardIds()).toHaveLength(PENDING_PAGE), {
    timeout: 20000
  });
  expect(cardIds()[0]).toBe(150);
  expect(screen.queryByText('#1')).toBeNull();
  // Never "nothing is waiting", and never a figure that reads as all of them.
  expect(screen.queryByText('Nothing is waiting for a signature.')).toBeNull();
  await waitFor(() => expect(statementOf()?.textContent).toMatch(/130 older/));
  await screen.findByText('20+');

  // Checks only for the cards on the page.
  await waitFor(() =>
    expect(readCardChecks).toHaveBeenCalledTimes(PENDING_PAGE)
  );

  await waitFor(() => expect(button('Load more').disabled).toBe(false), {
    timeout: 20000
  });
  await act(async () => {
    button('Load more').click();
  });
  await screen.findByText('#130', {}, { timeout: 20000 });
  await waitFor(() => expect(cardIds()).toHaveLength(2 * PENDING_PAGE), {
    timeout: 20000
  });
  expect(cardIds()[0]).toBe(150);
  await waitFor(() => expect(statementOf()?.textContent).toMatch(/110 older/));
  await waitFor(() =>
    expect(readCardChecks).toHaveBeenCalledTimes(2 * PENDING_PAGE)
  );
});

test('a poison on a small safe: every number read, so the list says it is whole', async () => {
  configure({ count: 3, bulkFails: true });
  renderPage();
  await screen.findByText(
    /Every action number has been read/,
    {},
    { timeout: 20000 }
  );
  expect(statementOf()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  expect(screen.getByText('3')).toBeTruthy();
});

test('the bulk view works: the count is the whole list, the page the newest', async () => {
  configure({ count: 150, bulkFails: false });
  renderPage();
  await screen.findByText(/Showing 20 of 150/, {}, { timeout: 20000 });
  expect(cardIds()[0]).toBe(150);
  expect(screen.getByText('150')).toBeTruthy();
  expect(statementOf()).toBeNull();
  await waitFor(() => expect(button('Load more').disabled).toBe(false), {
    timeout: 20000
  });
  await act(async () => {
    button('Load more').click();
  });
  await screen.findByText(/Showing 40 of 150/, {}, { timeout: 20000 });
  expect(cardIds()).toHaveLength(40);
});

test("Sign waits for a card's checks, and a card shows before them", async () => {
  configure({ count: 2, bulkFails: false });
  const release: ((value: any) => void)[] = [];
  (readCardChecks as jest.Mock).mockImplementation(
    () => new Promise((resolve) => release.push(resolve))
  );
  renderPage();
  await screen.findByText('#2', {}, { timeout: 20000 });
  await screen.findAllByRole('button', { name: 'Sign' }, { timeout: 20000 });
  screen
    .getAllByRole('button', { name: 'Sign' })
    .forEach((sign) => expect((sign as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getAllByText(/Sign and Carry it out wait/)).toHaveLength(2);

  await act(async () => {
    release.forEach((answer) =>
      answer({
        checks: [{ tone: 'ok', text: 'The safe owns the contract it calls.' }],
        perform: { simulate: true }
      })
    );
  });
  await waitFor(() =>
    screen
      .getAllByRole('button', { name: 'Sign' })
      .forEach((sign) =>
        expect((sign as HTMLButtonElement).disabled).toBe(false)
      )
  );
  expect(screen.queryByText(/Sign and Carry it out wait/)).toBeNull();
  expect(
    screen.getAllByText('The safe owns the contract it calls.')
  ).toHaveLength(2);
});

test('a check that failed stays on the card and holds it, until it has been run again', async () => {
  configure({ count: 1, bulkFails: false });
  (readCardChecks as jest.Mock).mockImplementation(async () => ({
    checks: [
      { tone: 'bad', text: 'The checks of this action could not be run.' }
    ],
    perform: { simulate: true },
    failed: true
  }));
  renderPage();
  await screen.findByText(
    'The checks of this action could not be run.',
    {},
    { timeout: 20000 }
  );
  await screen.findByRole('button', { name: 'Sign' }, { timeout: 20000 });
  expect(button('Sign').disabled).toBe(true);
  // Discard does not wait: it clears an action, and depends on no check.
  await waitFor(() => expect(button('Discard').disabled).toBe(false), {
    timeout: 20000
  });

  (readCardChecks as jest.Mock).mockImplementation(async () => ({
    checks: [],
    perform: { simulate: true }
  }));
  fireEvent.click(button('Check again'));
  await waitFor(() =>
    expect(
      screen.queryByText('The checks of this action could not be run.')
    ).toBeNull()
  );
  expect(button('Sign').disabled).toBe(false);
});

test('a card held for its code stays held when its checks arrive', async () => {
  configure({ count: 1, bulkFails: false });
  (readCardChecks as jest.Mock).mockImplementation(async () => ({
    checks: [],
    upgrade: { sourceUnread: true, sourceHash: null, targetHash: null },
    perform: { simulate: true }
  }));
  renderPage();
  await screen.findByRole('button', { name: 'Sign' }, { timeout: 20000 });
  await waitFor(() => expect(readCardChecks).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(button('Sign').disabled).toBe(true);
});

test('nothing about the actions is stored in the browser', async () => {
  configure({ count: 3, bulkFails: true });
  renderPage();
  await screen.findByText(
    /Every action number has been read/,
    {},
    { timeout: 20000 }
  );
  const stored = JSON.stringify({
    ...window.localStorage,
    ...window.sessionStorage
  });
  expect(stored).not.toMatch(/setFee|finished/);
});
