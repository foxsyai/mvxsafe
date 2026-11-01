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
