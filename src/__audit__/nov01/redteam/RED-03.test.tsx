// RED-03 (redteam audit, 1 Nov 2026): a flood of cheap proposals, plus one
// poison action, keeps every board member from signing anything through this
// page. It gets round the SC-01 fix of 21 Oct.
//
// A proposer (or a rogue board member) files N actions at about 0.0001 EGLD
// each; a proposer cannot sign, so every one stays pending for ever, and the
// SC-01 memory of finished ids never applies to them. One more action of
// about 12 KB makes getPendingActionFullInfo fail, so the page reads the
// actions one by one. The page then makes, before it shows a single pending
// card or a single Sign button: for EVERY pending action its data, its
// signers and a cost trial (three network calls), through a queue the public
// API limits to about four a second. 300 actions are about 900 calls, four
// minutes at best, on every load and every Refresh (the cache lasts two
// minutes); 3,000 actions, under a dollar of fees, are the better part of an
// hour. Meanwhile the one action that matters, "Remove <the rogue> from the
// board", is in that list too, and cannot be signed here until the list is
// shown. The board is locked out of mvxsafe.
//
// Without the poison it is two calls an action, half the wait: the page
// still inspects every action before it shows any.
jest.mock('multisig/network', () => require('./RED-03.mock').networkMock);
jest.mock('lib', () => require('../../display/mocks').libMock);
jest.mock('multisig/actions', () => require('../../display/mocks').actionsMock);

import '../../display/restoreSetImmediate';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Safe } from 'pages/Safe/Safe';
import { connectAs } from '../../display/mocks';
import { BOB, callCount, configure, SAFE } from './RED-03.mock';

jest.setTimeout(120000);

/**
 * How many network calls the page may make before the first pending card. A
 * page of twenty actions read in full is about 75; the flood below is 150
 * actions, 450 calls with the poison and about 165 without.
 */
const CALLS_BEFORE_FIRST_CARD = 100;
const FLOOD = 150;

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/safe/${SAFE}`]}>
      <Routes>
        <Route path='/safe/:address' element={<Safe />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => connectAs(BOB));

test('control: three pending actions and a poison show their first card after a handful of calls', async () => {
  configure({ count: 3, bulkFails: true });
  renderPage();
  await screen.findByText(/^#1$/, {}, { timeout: 20000 });
  expect(callCount()).toBeLessThan(CALLS_BEFORE_FIRST_CARD);
  // The role read lands a moment after the list: Sign follows.
  expect(
    (await screen.findAllByText('Sign', {}, { timeout: 20000 })).length
  ).toBeGreaterThan(0);
});

// Newest first (fix phase): the first card of a flood is its newest action.
test(`${FLOOD} flooded actions and a poison: the first card, and with it Sign, waits for every action to be read and tried`, async () => {
  configure({ count: FLOOD, bulkFails: true });
  renderPage();
  await screen.findByText(new RegExp(`^#${FLOOD}$`), {}, { timeout: 100000 });
  expect(callCount()).toBeLessThan(CALLS_BEFORE_FIRST_CARD);
});

test(`${FLOOD} flooded actions with the bulk view working: still every action is tried before any is shown`, async () => {
  configure({ count: FLOOD, bulkFails: false });
  renderPage();
  await screen.findByText(new RegExp(`^#${FLOOD}$`), {}, { timeout: 100000 });
  expect(callCount()).toBeLessThan(CALLS_BEFORE_FIRST_CARD);
});
