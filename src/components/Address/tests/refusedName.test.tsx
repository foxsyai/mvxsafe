// A typed name that cannot be shown (it looks like an address, or mixes
// alphabets in one word) is not saved, and the box says so instead of
// dropping what was typed without a word.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddressLine } from 'components/Address';
import { getLabel } from 'multisig/addressBook';

jest.mock('multisig/addressBook', () => ({
  ...jest.requireActual('multisig/addressBook'),
  readHerotag: () => Promise.resolve('')
}));

const ADDRESS = 'erd1etc22n3wel7s452mkvfy2aw3zpef7lmdkkyv9xcryzssdcpahlnsvnzga0';

beforeEach(() => window.localStorage.clear());

const typeName = (name: string) => {
  render(<AddressLine address={ADDRESS} nameable />);
  fireEvent.click(screen.getByRole('button', { name: 'Give this address a name' }));
  fireEvent.change(screen.getByPlaceholderText('A name for this address'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
};

test('control: an ordinary name is saved and shown', () => {
  typeName('Erin');
  expect(getLabel(ADDRESS)).toBe('Erin');
  expect(screen.getByText('Erin')).toBeInTheDocument();
});

test('a name that looks like an address is refused, with a reason, and the box stays open', () => {
  typeName('erd1qqqqqq...abcd');
  expect(getLabel(ADDRESS)).toBe('');
  expect(screen.getByRole('alert')).toHaveTextContent(/cannot look like an address/);
  expect(screen.getByPlaceholderText('A name for this address')).toBeInTheDocument();
});
