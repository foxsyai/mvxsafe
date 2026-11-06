// VFM-04: the guide's checklist for a vesting batch leaves out the token and
// whether the batch can be cancelled (vestings-from-a-safe audit, 6 Nov 2026).
//
// Step 12 tells a signer what to check before signing a batch: that the
// sentence names mvxvest at the agreed address, that every vesting listed
// matches the agreed list ("the beneficiary, each date (in UTC) and each
// amount"), and the green fee line. Followed exactly, that approves:
//
//   - the agreed people, dates and amounts of ANOTHER TOKEN the safe holds
//     (the amounts are per vesting; the token is named only in the sentence
//     and the box, which the checklist does not ask about);
//   - a batch that is NOT cancelable when the board agreed cancelable ones:
//     the step opens with "mvxvest gives it one cancel key per vesting" as if
//     every batch did, and never asks the signer to read the amber line
//     "Not cancelable: once carried out, nobody can stop these vestings or
//     get their tokens back". That one cannot be undone.
//
// The card shows both (the sentence names the token and ends "Nobody will be
// able to cancel them", the check line is amber), so the fix is in the words:
// say keys come only for a cancelable batch, and add the token and the
// cancelable line to what is checked.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Guide } from 'pages/Guide/Guide';

// The generated config file is not in git and may hold any network.
jest.mock('config', () => ({
  ...jest.requireActual('config'),
  environment: 'devnet'
}));

/** The text of the guide's vesting step. */
const step = () => {
  render(
    <MemoryRouter>
      <Guide />
    </MemoryRouter>
  );
  const heading = screen.getByRole('heading', {
    name: 'Create and cancel vestings'
  });
  return heading.nextElementSibling?.textContent ?? '';
};

/** What the step asks a signer to check before signing a batch. */
const checklist = (text: string) => {
  const from = text.indexOf('Before you sign');
  const to = text.indexOf('fees go to its owner');
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
};

describe('VFM-04: what the guide tells a signer to check on a batch', () => {
  it('control: the address, the beneficiaries with dates and amounts, and the fee line', () => {
    const checks = checklist(step());
    expect(checks).toMatch(/address/);
    expect(checks).toMatch(/beneficiary/);
    expect(checks).toMatch(/date/);
    expect(checks).toMatch(/amount/);
    expect(checks).toMatch(/pays exactly what mvxvest wants now/);
  });

  it('asks the signer to check the token the batch vests', () => {
    expect(checklist(step())).toMatch(/token/);
  });

  it('asks the signer to check whether the batch can be cancelled', () => {
    expect(checklist(step())).toMatch(/cancel/);
  });
});
