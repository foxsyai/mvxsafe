// REV-01 (low): the header fits the connected address into element.clientWidth,
// which is an integer. Chrome rounds it (a 155.875px box reports 156), while
// the real box is fractional and the button's `truncate` draws a second
// ellipsis over the end of any text that is even 0.03px too wide. Measured in
// Chrome 154 with the app's font (Satoshi 12px): with boxes pinned just under a
// candidate width, 70 of 72 overflows drew the ellipsis
// (review-2026-10-10/scratch/fit-window.mjs). So for a box of 92.6px, which
// reports 93, the 92.69px candidate "erd1etc22…nzga0" is chosen and the signer
// sees "erd1etc22…nzg…": a suffix that is not the address's suffix.
//
// The fix is one line in AccountName.tsx: measure the room as
// element.getBoundingClientRect().width (fractional), or leave a pixel of
// margin, instead of clientWidth.
import { act, render, screen } from '@testing-library/react';
import { AccountName } from 'components/ConnectButton/AccountName';

jest.mock('multisig/addressBook', () => ({
  getLabel: () => '',
  readHerotag: () => Promise.resolve('')
}));

const ADDRESS = 'erd1etc22n3wel7s452mkvfy2aw3zpef7lmdkkyv9xcryzssdcpahlnsvnzga0';

// The widths Chrome measured for this address in the header's font, by the
// length of the fitted text: 3+3 is 11 characters, up to 6+6 at 17.
const SATOSHI_12PX: Record<number, number> = { 11: 66.588, 13: 79.177, 15: 92.689, 17: 104.305 };
const widthOf = (text: string) => SATOSHI_12PX[text.length] ?? text.length * 6.1;

// The box the button really has, in CSS pixels. clientWidth reports it rounded,
// as Chrome does; getBoundingClientRect reports it as it is.
let box = 0;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => Math.round(box)
  });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: box, height: 16, top: 0, left: 0, right: box, bottom: 16, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  // A phone: the (min-width: 640px) query does not match, so the room is measured.
  window.matchMedia = () => ({ matches: false, media: '', onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false });
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    font: '',
    measureText: (text: string) => ({ width: widthOf(text) })
  });
});

const shownFor = async (width: number) => {
  box = width;
  render(<AccountName address={ADDRESS} />);
  await act(async () => {});
  return screen.getByRole('button').textContent ?? '';
};

test('control: a box of exactly 93px takes the 92.69px form, 5 + 5', async () => {
  const shown = await shownFor(93);
  expect(shown).toBe('erd1etc22…nzga0');
  expect(widthOf(shown)).toBeLessThanOrEqual(93);
});

test('a box of 92.6px, which clientWidth reports as 93, must get a text no wider than 92.6px', async () => {
  const shown = await shownFor(92.6);
  expect(widthOf(shown)).toBeLessThanOrEqual(92.6);
});
