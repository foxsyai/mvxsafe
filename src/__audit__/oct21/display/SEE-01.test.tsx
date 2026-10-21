// SEE-01: three REAL MultiversX built-in functions are missing from the app's
// built-in list (src/multisig/legacyCalls.js, PROTOCOL_BUILTINS), so the rule
// added on 14 Oct 2026 -- "every built-in function of the network named in a
// call is red on the card and refused by the call form" (mvxvest's audit,
// UPG-01 follow-up) -- is silently bypassed for them:
//
//   ESDTMetaDataRecreate, ESDTMetaDataUpdate  -- rewrite an NFT/dynamic token's
//       name, royalties, hash, attributes and URIs;
//   ESDTSetNewURIs                            -- replace an NFT's URIs.
//
// The list even contains "ESDTNFTSetNewURIs", which is the GAS-SCHEDULE label,
// not the function name a transaction carries; the real name the SDK and the
// protocol use is "ESDTSetNewURIs" (proven below from the SDK itself). All
// three are sent to the sender's OWN account (receiver === sender), so a safe
// runs them on tokens IT holds a role for. On the pending card they read as an
// ordinary green "Call <name>(...) on <contract>" with no red check, and the
// Call form proposes them without protest -- exactly what the rule forbids.
//
// The fix is to add these names (and remove the mislabelled ESDTNFTSetNewURIs)
// to PROTOCOL_BUILTINS. The controls below show the mechanism already works for
// the names that ARE listed, and that ordinary contract endpoints stay allowed,
// so this test is not "refuse everything".
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({ proposeCall: jest.fn() }));

import '../../display/restoreSetImmediate';
import {
  Address,
  TokenManagementTransactionsFactory,
  TransactionsFactoryConfig
} from '@multiversx/sdk-core';
import { inspectAction } from 'multisig/inspect';
import { builtInRefusal, predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockTrial
} from '../../../multisig/tests/contractsMock';
import { CAROL, SAFE } from '../../display/fixtures';

// A contract the safe owns (so the card's other checks go green: "the safe owns
// the contract it calls" and the trial "it works"), making the missing red
// stand out as the only thing between the signer and a built-in.
const TARGET = predictSafeAddress(CAROL, 40);

const u8 = (text: string) => Uint8Array.from(Buffer.from(text));
const call = (to: string, endpoint: string) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to,
      egld_amount: 0n,
      endpoint_name: u8(endpoint),
      arguments: [u8('LKMEX-aab910'), Uint8Array.of(1)]
    }
  ]
});
const redChecks = async (action: any) =>
  (await inspectAction(action, SAFE)).checks.filter(
    (check) => check.tone === 'bad' && !check.advisory
  );

beforeEach(() => {
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: '11'.repeat(32) });
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
});

// Provenance: the names below are what the SDK (and the protocol) put in a
// transaction's data; nobody is being asked to trust a hand-written list.
const factory = new TokenManagementTransactionsFactory({
  config: new TransactionsFactoryConfig({ chainID: 'D' })
});
const firstDataPart = (transaction: { data: Uint8Array }) =>
  new TextDecoder().decode(transaction.data).split('@')[0];
const someSc = Address.newFromBech32(TARGET);

describe('SEE-01: real network built-ins slip past the "every built-in" gate', () => {
  test('the SDK names them ESDTMetaDataRecreate / ESDTMetaDataUpdate / ESDTSetNewURIs, sent to self', async () => {
    const recreate = await factory.createTransactionForMetadataRecreate(
      someSc,
      {
        tokenIdentifier: 'LKMEX-aab910',
        tokenNonce: 1n,
        newTokenName: 'x',
        newRoyalties: 0n,
        newHash: '',
        newAttributes: new Uint8Array(),
        newUris: ['u']
      }
    );
    const update = await factory.createTransactionForUpdatingMetadata(someSc, {
      tokenIdentifier: 'LKMEX-aab910',
      tokenNonce: 1n
    });
    const uris = await factory.createTransactionForSettingNewUris(someSc, {
      tokenIdentifier: 'LKMEX-aab910',
      tokenNonce: 1n,
      newUris: ['u']
    });
    expect(firstDataPart(recreate)).toBe('ESDTMetaDataRecreate');
    expect(firstDataPart(update)).toBe('ESDTMetaDataUpdate');
    expect(firstDataPart(uris)).toBe('ESDTSetNewURIs');
    // Sent to the sender's own account: a safe runs them on its own tokens.
    expect(recreate.receiver.toBech32()).toBe(someSc.toBech32());
  });

  test.each(['ESDTMetaDataRecreate', 'ESDTMetaDataUpdate', 'ESDTSetNewURIs'])(
    'the Call form must refuse the built-in %s',
    (name) => {
      // builtInRefusal is exactly what CallForm uses to block Propose.
      expect(builtInRefusal(name)).not.toBe('');
    }
  );

  test.each(['ESDTMetaDataRecreate', 'ESDTMetaDataUpdate', 'ESDTSetNewURIs'])(
    'the pending card must show %s in red, not as an ordinary call',
    async (name) => {
      const checks = await redChecks(call(TARGET, name));
      expect(checks.map((check) => check.text).join(' ')).toMatch(
        /built-in function of the network/
      );
    }
  );

  // --- controls: the gate already works for listed names, and ordinary
  //     endpoints stay allowed, so the assertions above are not vacuous. ---
  test('control: a listed built-in (SetGuardian) is refused and red', async () => {
    expect(builtInRefusal('SetGuardian')).not.toBe('');
    expect(await redChecks(call(TARGET, 'SetGuardian'))).not.toHaveLength(0);
  });

  test('control: an ordinary contract endpoint is allowed, and not built-in-red', async () => {
    expect(builtInRefusal('setTokenFee')).toBe('');
    expect(builtInRefusal('ClaimDeveloperRewards')).toBe('');
    const checks = await redChecks(call(TARGET, 'setTokenFee'));
    expect(checks.map((check) => check.text).join(' ')).not.toMatch(
      /built-in function of the network/
    );
  });
});
