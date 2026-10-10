import { bestFit, fitAddress } from '../AccountName';

const ADDRESS = 'erd1etc22n3wel7s452mkvfy2aw3zpef7lmdkkyv9xcryzssdcpahlnsvnzga0';
// Seven pixels a character is close enough to the header's 12px type.
const measure = (text: string) => text.length * 7;

test('erd1, then n characters from each end of the address', () => {
  expect(fitAddress(ADDRESS, 3)).toBe('erd1etc…ga0');
  expect(fitAddress(ADDRESS, 5)).toBe('erd1etc22…nzga0');
});

test('takes as many characters as the room allows, 3 + 3 to 6 + 6', () => {
  expect(bestFit(ADDRESS, 77, measure)).toBe(3); // 11 characters
  expect(bestFit(ADDRESS, 91, measure)).toBe(4); // 13 characters
  expect(bestFit(ADDRESS, 1000, measure)).toBe(6);
});

test('never fewer than 3 + 3, even with no room', () => {
  expect(bestFit(ADDRESS, 10, measure)).toBe(3);
});
