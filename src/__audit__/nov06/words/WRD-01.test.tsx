// WRD-01: what the How it works page tells a MetaMask signer about the
// "Connect to" prompt (review of PR #24, 6 Nov 2026).
//
// The page says, in step 3: "The first time, MetaMask asks you to connect to
// snap.multiversx.com, the Snap's own page that mvxsafe opens for it." Three
// things in that sentence are not what the Snap does, read from the Snap's own
// bundle (npm @multiversx/metamask-snap 2.0.0, the SIGN_TOKEN handler) and
// from the Snap page's script (the network's iframeWalletAddress):
//
//   1. The prompt comes with EVERY sign-in, not only the first: the Snap shows
//      it each time it signs the sign-in token, and a sign-in lasts a day.
//   2. The prompt names the Snap page of the network: devnet-snap.multiversx.com
//      on the devnet site, where this page is also served and where signers
//      rehearse. The page names the mainnet host on both.
//   3. The prompt itself says "Scam/phishing verification: Double check the
//      browser's address bar and confirm that you are indeed connecting to
//      <the Snap's host>". That check can never hold here: the address bar
//      reads this site, because the Snap's page is opened inside it. A
//      look-alike site framing the same Snap page gets the very same prompt.
//      The one check that tells them apart is the address bar reading this
//      site's own name, and the page does not say so. The private guide for
//      a firm's signers does; the public page is what everyone else reads.
//
// The fix: say that MetaMask shows "Connect to: <the network's Snap host>"
// at every sign-in, that its own address-bar check cannot hold here, and
// that the address bar must read this site's name, or the signer rejects.
import { fallbackNetworkConfigurations } from '@multiversx/sdk-dapp/out/constants/network.constants';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Guide } from 'pages/Guide/Guide';

// The devnet site serves the same page. The generated config file is not in
// git and may hold any network, so the network is pinned here.
jest.mock('config', () => ({
  ...jest.requireActual('config'),
  environment: 'devnet'
}));

const text = () =>
  render(
    <MemoryRouter>
      <Guide />
    </MemoryRouter>
  ).container.textContent ?? '';

// The host MetaMask's prompt names: the frame mvxsafe opens for the Snap.
const snapHost = new URL(
  fallbackNetworkConfigurations.devnet.iframeWalletAddress ?? ''
).host;

describe('WRD-01: the guide on MetaMask asking to connect', () => {
  it('control: says the sign-in is a message that cannot move anything', () => {
    expect(text()).toContain('It is a message and not a transaction');
    expect(text()).toContain('it cannot move anything');
  });

  it('control: the devnet site frames the devnet Snap page, not the mainnet one', () => {
    expect(snapHost).toBe('devnet-snap.multiversx.com');
    expect(fallbackNetworkConfigurations.mainnet.iframeWalletAddress).toBe(
      'https://snap.multiversx.com'
    );
  });

  it('names the Snap page of the network this page is served for', () => {
    expect(text()).toContain(snapHost);
  });

  it('tells the signer the address bar must read this site, the one check a look-alike fails', () => {
    expect(text()).toMatch(/address bar/i);
  });

  it('does not present the prompt as a first-time thing: it comes with every sign-in', () => {
    expect(text()).not.toMatch(/The first time, MetaMask asks/);
  });
});
