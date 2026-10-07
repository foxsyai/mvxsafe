// TX-05: a blank amount proposes a transfer of nothing.
//
// The amount field in ProposePanel.tsx:207 is a free text input with no
// validation, and toRawAmount turns "", "   ", "." and "-" into 0n. The
// builders then produce a well-formed proposal: proposeTransferExecute@to@
// (zero EGLD, no call) or proposeAsyncCall@to@@ESDTTransfer@token@ (zero
// tokens). The contract accepts both. Somebody who presses Propose before
// filling in the amount signs and pays for a proposal that can never do what
// they meant, and the board then has to unsign and discard it.
import { buildProposeEgld, buildProposeToken } from 'multisig/legacyCalls';

const ctx = {
  chainId: 'D',
  sender: 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3',
  nonce: 1,
  safe: 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy'
};
const to = 'erd1cus9zpgyg8ztpvr48j8w8lqack3u7gtlnxlum22cdl0k0vfwm3eq54npug';

const blanks = ['', '   ', '.', '-'];

describe('TX-05: a blank amount is refused rather than proposed as zero', () => {
  test.each(blanks)('an EGLD proposal with amount %j is refused', async (amount) => {
    const attempt = async () => buildProposeEgld(ctx, { to, amount });
    await expect(attempt()).rejects.toThrow();
  });

  test.each(blanks)('a token proposal with amount %j is refused', async (amount) => {
    const attempt = async () =>
      buildProposeToken(ctx, { to, tokenIdentifier: 'WEGLD-a28c59', amount, decimals: 18 });
    await expect(attempt()).rejects.toThrow();
  });
});
