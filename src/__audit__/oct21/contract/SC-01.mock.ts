// Support mock for SC-01 (not a test file itself). It reproduces, in jest, the
// devnet fact proven by proofs/SC-01.mjs:
//   - getPendingActionFullInfo (the ONE view readPendingActions reads) fails to
//     decode, because one stored action carries a large (~12 KB) argument;
//   - every per-action view still answers: getActionData(id) for the legitimate
//     actions, and getActionData(poison) fails the same way, while the signer
//     views answer for both (so the poison can be unsigned + discarded by id).
// The encoders are the display audit's, so the bytes decode through the real ABI.
import { Address } from '@multiversx/sdk-core';
import {
  bigBytes,
  encodeAction,
  encodeActionFullInfo
} from '../../display/fixtures';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
export const SAFE =
  'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
export const LEGIT_ID = 1;
export const POISON_ID = 2;
const DECODE_ERROR = 'storage decode error: invalid value';

// A legitimate action the board needs to see and act on: send 0.001 EGLD.
const legitAction = {
  kind: 'SendTransferExecute' as const,
  to: ALICE,
  egld: 10n ** 15n
};

const addr = (bech32: string) => Address.newFromBech32(bech32).getPublicKey();
const idOf = (args: Uint8Array[]): number =>
  args[0] && args[0].length
    ? parseInt(Buffer.from(args[0]).toString('hex'), 16)
    : 0;
/** Flip the bulk-view failure on or off for a test. */
export const setBulkFails = (value: boolean) => {
  (globalThis as any).__sc01_bulkFails = value;
};

const queryContract = async ({
  function: fn,
  arguments: args = [] as Uint8Array[]
}: {
  function: string;
  arguments?: Uint8Array[];
}) => {
  // The SDK's parseQueryResponse reads `.function` off the response.
  const parts = (returnDataParts: Uint8Array[]) => ({
    function: fn,
    returnCode: 'ok',
    returnMessage: '',
    returnDataParts
  });
  switch (fn) {
    case 'getQuorum':
      return parts([bigBytes(1n)]);
    case 'getAllBoardMembers':
      return parts([addr(ALICE)]);
    case 'getNumProposers':
      return parts([bigBytes(0n)]);
    case 'getAllProposers':
      return parts([]);
    case 'getActionLastIndex':
      return parts([bigBytes(BigInt(POISON_ID))]);
    case 'getPendingActionFullInfo':
      if ((globalThis as any).__sc01_bulkFails) throw new Error(DECODE_ERROR);
      return parts([
        encodeActionFullInfo({
          id: LEGIT_ID,
          action: legitAction,
          signers: [ALICE]
        })
      ]);
    case 'getActionData': {
      const id = idOf(args);
      if (id === POISON_ID) throw new Error(DECODE_ERROR);
      if (id === LEGIT_ID) return parts([encodeAction(legitAction)]);
      throw new Error(`no action ${id}`);
    }
    case 'getActionSigners':
      return parts([addr(ALICE)]);
    case 'getActionSignerCount':
    case 'getActionValidSignerCount':
      return parts([bigBytes(1n)]);
    case 'quorumReached':
      return parts([Uint8Array.of(1)]);
    default:
      throw new Error(`SC-01 mock has no answer for ${fn}`);
  }
};

export const networkMock = {
  networkName: 'devnet',
  apiUrl: 'https://devnet-api.multiversx.com',
  chainId: 'D',
  explorerUrl: 'https://devnet-explorer.multiversx.com',
  clearCache: () => {},
  forget: () => {},
  isTransient: (error: any) =>
    !/function not found|invalid function|execution failed|user error|wrong number of arguments/i.test(
      String(error?.message ?? error ?? '')
    ),
  cached: async <T>(_key: string, work: () => Promise<T>) => work(),
  api: async (path: string) => {
    if (path.startsWith('/economics')) return { price: 0 };
    if (/^\/accounts\/[^/?]+(\?|$)/.test(path)) return { balance: '0' };
    if (/\/tokens/.test(path)) return [];
    if (/\/nfts\/count/.test(path)) return 0;
    if (/\/transactions/.test(path)) return [];
    throw new Error(`SC-01 mock has no api answer for ${path}`);
  },
  networkProvider: {
    queryContract,
    getAccount: async () => ({ nonce: 0n, balance: 0n })
  }
};
