// Support mock for RED-03 (not a test file). A safe with `count` pending
// actions filed by a proposer (so none is signed and none ever finishes), and
// optionally one poison action that makes the bulk view fail, as SC-01's
// devnet proof showed is possible. The network is paced: every contract
// query, API read and cost trial takes PACE_MS and runs one at a time, a
// mild version of the public API's "four a second, three at a time". Reads of
// the same thing are shared and remembered, as in multisig/network.
import { Address } from '@multiversx/sdk-core';
import { codeHashOf } from 'multisig/legacyCalls';
import {
  bigBytes,
  encodeAction,
  encodeActionFullInfo
} from '../../display/fixtures';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
export const BOB =
  'erd1cus9zpgyg8ztpvr48j8w8lqack3u7gtlnxlum22cdl0k0vfwm3eq54npug';
const CAROL = 'erd1ydw9sph9z0cxggqtvwr59y27g5uw7atvdg03pec3tyyj9uafaujqsx035a';
export const SAFE =
  'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
/** A contract the safe owns, the target of every flooded call. */
const OWNED = 'erd1qqqqqqqqqqqqqpgqntmhxqa29ar4juhlprjjxaq790ykcj3uaujq2l9dzg';
const DECODE_ERROR = 'storage decode error: invalid value';
const PACE_MS = 5;

let settings = { count: 3, bulkFails: false };
let calls = 0;
let chain: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<unknown>>();
const apiCache = new Map<string, Promise<unknown>>();

export const configure = (next: { count: number; bulkFails: boolean }) => {
  settings = next;
  calls = 0;
  chain = Promise.resolve();
  cache.clear();
  apiCache.clear();
};
/** How many network calls have been made since configure(). */
export const callCount = () => calls;

/** One at a time, PACE_MS each, counted. */
const paced = <T>(work: () => T): Promise<T> => {
  const run = chain.then(async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    return work();
  });
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

const addr = (bech32: string) => Address.newFromBech32(bech32).getPublicKey();
const idOf = (args: Uint8Array[]): number =>
  args[0] && args[0].length
    ? parseInt(Buffer.from(args[0]).toString('hex'), 16)
    : 0;

/** Action `id`: setFee(id) on the owned contract, each one distinct. */
const action = (id: number) => ({
  kind: 'SendAsyncCall' as const,
  to: OWNED,
  egld: 0n,
  endpoint: 'setFee',
  args: [bigBytes(BigInt(id))]
});

const queryContract = async ({
  function: fn,
  arguments: args = [] as Uint8Array[]
}: {
  function: string;
  arguments?: Uint8Array[];
}) =>
  paced(() => {
    const parts = (returnDataParts: Uint8Array[]) => ({
      function: fn,
      returnCode: 'ok',
      returnMessage: '',
      returnDataParts
    });
    const ids = Array.from({ length: settings.count }, (_, at) => at + 1);
    switch (fn) {
      case 'getQuorum':
        return parts([bigBytes(2n)]);
      case 'getAllBoardMembers':
        return parts([addr(ALICE), addr(BOB), addr(CAROL)]);
      case 'getNumProposers':
        return parts([bigBytes(1n)]);
      case 'getAllProposers':
        return parts([]);
      case 'getActionLastIndex':
        return parts([bigBytes(BigInt(settings.count))]);
      case 'userRole':
        return parts([
          bigBytes(new Address(args[0]).toBech32() === BOB ? 2n : 0n)
        ]);
      case 'getPendingActionFullInfo':
        if (settings.bulkFails) throw new Error(DECODE_ERROR);
        return parts(
          ids.map((id) =>
            encodeActionFullInfo({ id, action: action(id), signers: [] })
          )
        );
      case 'getActionData': {
        const id = idOf(args);
        if (id < 1 || id > settings.count) throw new Error(`no action ${id}`);
        return parts([encodeAction(action(id))]);
      }
      case 'getActionSigners':
        // A List<Address> is one return part, the addresses concatenated: no
        // signer is one empty part, as the chain answers it.
        return parts([new Uint8Array(0)]);
      case 'getActionSignerCount':
      case 'getActionValidSignerCount':
        return parts([bigBytes(0n)]);
      case 'quorumReached':
        return parts([new Uint8Array(0)]);
      default:
        throw new Error(`RED-03 mock has no answer for ${fn}`);
    }
  });

const CODE = '0061736d01000000';
const codeHashBase64 = Buffer.from(
  codeHashOf(Uint8Array.from(Buffer.from(CODE, 'hex'))),
  'hex'
).toString('base64');

const apiAnswer = (path: string) => {
  if (path.startsWith('/economics')) return { price: 0 };
  if (path.startsWith(`/accounts/${OWNED}`)) {
    return {
      balance: '0',
      ownerAddress: SAFE,
      code: CODE,
      codeHash: codeHashBase64,
      isUpgradeable: true,
      isReadable: true,
      isPayable: false,
      isPayableBySmartContract: false
    };
  }
  if (/^\/accounts\/[^/?]+(\?|$)/.test(path)) return { balance: '0' };
  if (/\/tokens/.test(path)) return [];
  if (/\/nfts\/count/.test(path)) return 0;
  if (/\/transactions/.test(path)) return [];
  throw new Error(`RED-03 mock has no api answer for ${path}`);
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
  // Shared and remembered by key, as the real one.
  cached: <T>(key: string, work: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, work());
    return cache.get(key) as Promise<T>;
  },
  api: (path: string) => {
    if (!apiCache.has(path))
      apiCache.set(
        path,
        paced(() => apiAnswer(path))
      );
    return apiCache.get(path);
  },
  networkProvider: {
    queryContract,
    getAccount: async () => ({ nonce: 0n, balance: 0n }),
    // The cost trial of a call as the safe: paced like everything else.
    estimateTransactionCost: () => paced(() => ({ gasLimit: 4000000n }))
  }
};
