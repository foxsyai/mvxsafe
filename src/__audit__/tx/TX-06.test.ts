// TX-06: a 64-character hex string is accepted as an address.
//
// Every builder validates its address with `new Address(value)`, and sdk-core's
// Address constructor accepts a 64-hex string as a raw public key
// (core/address.js, Address.isValidHex). A transaction hash is exactly 64 hex
// characters. A proposer who pastes a hash, or any other 64-hex value, into
// the Recipient or "Address to add" field therefore gets a VALID proposal to a
// different bech32 address that nobody holds the key to. The form's own hint
// says "A MultiversX address, starting with erd1", and savedSafes.ts already
// has isValidSafeAddress for exactly this check, but the propose path never
// applies it. The signers see "Send 1 EGLD to erd1cn8w9h...0mccyp" and have no
// way to tell it was never an address.
import {
  buildProposeAddBoardMember,
  buildProposeAddProposer,
  buildProposeEgld,
  buildProposeRemoveUser,
  buildProposeToken
} from 'multisig/legacyCalls';

const ctx = {
  chainId: 'D',
  sender: 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3',
  nonce: 1,
  safe: 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy'
};
// The shape of a transaction hash: 64 hex characters, no erd1.
const hash = 'c4cee2dd484da1a4a3f7363696ed1c53dc9baf41ee38ca4ab3000b025e2d6963';

describe('TX-06: only a bech32 erd1 address is accepted where an address is expected', () => {
  test('as the recipient of EGLD', async () => {
    const attempt = async () => buildProposeEgld(ctx, { to: hash, amount: '1' });
    await expect(attempt()).rejects.toThrow();
  });

  test('as the recipient of a token', async () => {
    const attempt = async () =>
      buildProposeToken(ctx, { to: hash, tokenIdentifier: 'FOXSY-5d5f3e', amount: '1', decimals: 18 });
    await expect(attempt()).rejects.toThrow();
  });

  test('as a new board member', async () => {
    const attempt = async () => buildProposeAddBoardMember(ctx, hash);
    await expect(attempt()).rejects.toThrow();
  });

  test('as a new proposer', async () => {
    const attempt = async () => buildProposeAddProposer(ctx, hash);
    await expect(attempt()).rejects.toThrow();
  });

  test('as a user to remove', async () => {
    const attempt = async () => buildProposeRemoveUser(ctx, hash);
    await expect(attempt()).rejects.toThrow();
  });

  test('upper-case hex is refused too', async () => {
    const attempt = async () => buildProposeEgld(ctx, { to: hash.toUpperCase(), amount: '1' });
    await expect(attempt()).rejects.toThrow();
  });
});
