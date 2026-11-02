import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Guide } from '../Guide';

// The manual has to say what the app does. It fell behind once: the fixes of 1 Nov
// 2026 and the call and upgrade tabs changed the safe page, and the guide, its
// pictures and the signer's PDF stayed as they were in October.

const guide = () =>
  render(
    <MemoryRouter>
      <Guide />
    </MemoryRouter>
  ).container;

const signerGuide = () =>
  readFileSync(resolve(process.cwd(), 'docs/signer-guide.html'), 'utf8')
    .replace(/<style[\s\S]*?<\/style>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('The guide', () => {
  it('shows only pictures that exist', () => {
    const pictures = [...guide().querySelectorAll('img')].map((image) =>
      image.getAttribute('src')
    );
    expect(pictures.length).toBeGreaterThan(18);
    pictures.forEach((picture) => {
      expect(
        statSync(resolve(process.cwd(), `public${picture}`)).size
      ).toBeGreaterThan(0);
    });
  });

  it('explains the red warnings of the safe page, in its words', () => {
    const text = guide().textContent;
    expect(text).toContain('does not run the multisig code mvxsafe knows');
    expect(text).toContain('not in its own hands');
    expect(text).toContain('needs no signatures');
  });

  it('covers every tab of Propose an action', () => {
    const text = guide().textContent;
    expect(text).toContain('Call a contract');
    expect(text).toContain('Upgrade a contract');
  });

  it('does not promise that every proposed call was proven to work', () => {
    const text = guide().textContent;
    expect(text).not.toContain('a call the contract refuses is not proposed');
    expect(text).toContain('cannot always be tried in advance');
  });

  it('explains how a long list of actions is read', () => {
    const text = guide().textContent;
    expect(text).toContain('Go to action #');
    expect(text).toContain('Load more');
    expect(text).toContain('not complete');
  });

  it('says who may carry an action out, and what gas it is given', () => {
    const text = guide().textContent;
    expect(text).toContain('any board member or proposer can carry the');
    expect(text).toMatch(/gas/i);
  });

  it('says which cards show a gas line, and which do not', () => {
    // Only a perform the network cannot simulate gets one (ActionChecks,
    // `!plan.simulate`): a payment, a call or an upgrade. A change of members
    // or quorum is simulated when it is carried out and shows none.
    const text = guide().textContent;
    expect(text).not.toContain('The card shows the gas the transaction');
    expect(text).toContain('For a payment, a call or an upgrade');
    expect(text).toContain('shows no gas line');
  });

  it('says why a safe with no EGLD cannot have its actions tried', () => {
    // The network tries a call as the safe only if the safe could pay its fee
    // (gas.js, simulateAsSafe). Seven real safes held none on 2 Nov 2026, so
    // every token payment card on them was amber. A plain EGLD payment is
    // never tried (inspectCall returns before any trial), so the guide must
    // not say it is.
    const text = guide().textContent;
    expect(text).toContain('Keep a little EGLD in the safe too');
    expect(text).toContain('tries a token payment or a call in advance');
    expect(text).toContain('the safe never pays gas');
  });

  it('does not claim the whole page comes from the contract', () => {
    expect(guide().textContent).not.toContain(
      'Everything on this page is read from the contract itself'
    );
  });

  it('keeps to the rule for visible copy', () => {
    const text = guide().textContent;
    expect(text).not.toMatch(/, (and|or) /);
    expect(text).not.toMatch(/[–—]| - /);
  });
});

describe("The signer's guide", () => {
  it('tells a signer to stop at a red warning', () => {
    expect(signerGuide()).toMatch(/red warning/i);
  });

  it('says who may carry an action out', () => {
    expect(signerGuide()).toContain('Any board member or proposer');
  });
});
