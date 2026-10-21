// TXN-04: the built-in refusal list is written with the gas schedule's cost
// keys, not with the names the network dispatches on, so some built-ins are
// neither refused by the call form nor red on the card.
//
// src/multisig/legacyCalls.js, PROTOCOL_BUILTINS: "ESDTNFTAddUri",
// "ESDTNFTRecreate", "ESDTNFTUpdate", "ESDTNFTSetNewURIs" and "SaveUserName"
// are keys of [BuiltInCost] in the gas schedule. The functions the network
// runs are named in mx-chain-core-go's core/constants.go: ESDTNFTAddURI,
// ESDTMetaDataRecreate, ESDTMetaDataUpdate, ESDTSetNewURIs, SetUserName. The
// match is exact and case-sensitive on chain, so a proposal naming
// "ESDTNFTAddURI" runs the built-in, while the form only refuses the
// misspelt "ESDTNFTAddUri", which is no function at all.
//
// Correct behaviour: every built-in the network runs is refused by the call
// form and red on the card, under the name the network knows it by.
import { builtInChecks } from 'multisig/inspect';
import { builtInRefusal, PROTOCOL_BUILTINS } from 'multisig/legacyCalls';

const SAFE = 'erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3';
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';

jest.mock('multisig/network', () => ({
  chainId: 'D',
  api: async () => ({}),
  cached: async (_key: string, work: () => Promise<unknown>) => work(),
  networkProvider: {}
}));

// The network's names (core/constants.go, mx-chain-core-go) for the
// built-ins the app lists under their gas-schedule keys.
const NETWORK_NAMES: Record<string, string> = {
  ESDTNFTAddUri: 'ESDTNFTAddURI',
  ESDTNFTRecreate: 'ESDTMetaDataRecreate',
  ESDTNFTUpdate: 'ESDTMetaDataUpdate',
  ESDTNFTSetNewURIs: 'ESDTSetNewURIs',
  SaveUserName: 'SetUserName'
};

describe('TXN-04: built-ins are refused under the names the network runs them by', () => {
  test.each(Object.entries(NETWORK_NAMES))(
    'the list carries %s, but the network runs %s, which is refused too',
    (_listed, networkName) => {
      expect(PROTOCOL_BUILTINS.has(networkName)).toBe(true);
      expect(builtInRefusal(networkName)).not.toBe('');
      const red = builtInChecks(networkName, CONTRACT, SAFE).filter(
        (check) => check.tone === 'bad'
      );
      expect(red.length).toBeGreaterThan(0);
    }
  );

  test('control: a built-in listed by its real name is refused and red', () => {
    expect(builtInRefusal('ESDTNFTUpdateAttributes')).not.toBe('');
    expect(
      builtInChecks('ESDTNFTUpdateAttributes', CONTRACT, SAFE).some(
        (check) => check.tone === 'bad'
      )
    ).toBe(true);
  });

  test("control: a contract's own function is neither refused nor red", () => {
    expect(builtInRefusal('setFee')).toBe('');
    expect(builtInChecks('setFee', CONTRACT, SAFE)).toEqual([]);
  });
});
