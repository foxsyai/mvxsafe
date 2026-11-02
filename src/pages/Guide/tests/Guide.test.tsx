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

// The text of one of the one-page guides in docs/, as it is printed.
const docText = (name: string) =>
  readFileSync(resolve(process.cwd(), `docs/${name}`), 'utf8')
    .replace(/<style[\s\S]*?<\/style>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

const signerGuide = () => docText('signer-guide.html');
const creatorGuide = () => docText('creator-guide.html');
const proposerGuide = () => docText('proposer-guide.html');

/** How many pages a PDF has, counted from its page objects. */
const pagesOf = (file: string) =>
  readFileSync(resolve(process.cwd(), file))
    .toString('latin1')
    .match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

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

  it('offers one single-page PDF per job, in the order create, propose, sign', () => {
    // Someone with one job reads one page and stops there (2 Nov 2026).
    const container = guide();
    const headings = [...container.querySelectorAll('h2')]
      .map((heading) => heading.textContent)
      .filter((title) => title?.startsWith('If you only have to'));
    expect(headings).toEqual([
      'If you only have to create a safe',
      'If you only have to propose',
      'If you only have to sign'
    ]);
    const links = [...container.querySelectorAll('a[href$=".pdf"]')].map(
      (link) => link.getAttribute('href')
    );
    expect(links).toEqual([
      '/mvxsafe-create-a-safe.pdf',
      '/mvxsafe-propose.pdf',
      '/mvxsafe-for-signers.pdf'
    ]);
    links.forEach((link) => {
      expect(pagesOf(`public${link}`)).toBe(1);
    });
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

describe("The creator's guide", () => {
  const text = () => creatorGuide();

  it('names the buttons and fields as the create page does', () => {
    expect(text()).toContain('Create a safe');
    expect(text()).toContain('Add a member');
    expect(text()).toContain('Signatures needed');
  });

  it('says what the two transactions do and how to check the safe owns itself', () => {
    expect(text()).toContain('two transactions');
    expect(text()).toContain('hands it to itself');
    expect(text()).toContain('Owner');
  });

  it('gives the fee the create page gives', () => {
    const createPage = readFileSync(
      resolve(process.cwd(), 'src/pages/Create/Create.tsx'),
      'utf8'
    );
    expect(createPage).toContain('0.073 EGLD');
    expect(text()).toContain('0.073 EGLD');
  });

  it('tells the rest of the board how to find the safe', () => {
    expect(text()).toContain('Add a safe');
  });

  it('promises only what a quorum of two or more gives', () => {
    // A 1 of 1 board gets no warning from the form (newSafe.ts), and with a
    // quorum of 1 one member acts alone: the handover protects the code, the
    // quorum the funds (review of PR #23).
    expect(text()).not.toMatch(/\. The page warns you otherwise/);
    expect(text()).toContain(
      'For a board of two or more, the page warns you otherwise'
    );
    expect(text()).not.toMatch(/From then on nobody, you included/);
    expect(text()).toContain(
      'with two or more signatures needed, nobody, you included, can move its funds or change it alone'
    );
  });
});

describe("The proposer's guide", () => {
  const text = () => proposerGuide();

  it('walks from Propose an action to Carry it out', () => {
    expect(text()).toContain('Propose an action');
    expect(text()).toContain('Send tokens');
    expect(text()).toContain('Carry it out');
    expect(text()).toMatch(/nothing moves/i);
  });

  it('asks for a small test amount and a second look at the address', () => {
    expect(text()).toMatch(/small test amount/i);
    expect(text()).toContain('character by character');
  });

  it('says a proposal by a board member counts as a signature, and one by a proposer does not', () => {
    expect(text()).toContain('A board member who proposes has signed');
    expect(text()).toContain('A proposer has not');
  });
});

describe('The three one-page guides', () => {
  it('keep to the rule for visible copy', () => {
    [signerGuide(), creatorGuide(), proposerGuide()].forEach((text) => {
      expect(text).not.toMatch(/, (and|or) /);
      expect(text).not.toMatch(/[–—!]| - /);
    });
  });
});
