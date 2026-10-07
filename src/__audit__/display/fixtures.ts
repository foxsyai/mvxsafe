// Fixtures for the display audit. Everything here builds the BYTES the contract
// returns for getPendingActionFullInfo and the other views, so that the shipped
// readPendingActions / describeAction code decodes them through the shipped ABI
// and the real SDK, exactly as in the browser. Only the network is replaced.
//
// Encoding follows the MultiversX codec: top-level values are the bare bytes;
// nested values are length-prefixed (u32 big endian) where their size varies.

import { Address } from '@multiversx/sdk-core';

export const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
export const BOB = 'erd1cus9zpgyg8ztpvr48j8w8lqack3u7gtlnxlum22cdl0k0vfwm3eq54npug';
export const CAROL = 'erd1ydw9sph9z0cxggqtvwr59y27g5uw7atvdg03pec3tyyj9uafaujqsx035a';
export const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
/** The ESDT system smart contract, where tokens are issued and roles are granted. */
export const ESDT_SYSTEM_SC = 'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzllls8a5w6u';

const concat = (...parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export const u32be = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};

/** Minimal big-endian bytes of an unsigned integer; empty for zero. */
export const bigBytes = (value: bigint): Uint8Array => {
  if (value === 0n) return new Uint8Array(0);
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Uint8Array.from(Buffer.from(hex, 'hex'));
};

export const utf8 = (text: string) => Uint8Array.from(Buffer.from(text, 'utf8'));
const addressBytes = (bech32: string) => Address.newFromBech32(bech32).getPublicKey();

// --- nested encodings --------------------------------------------------------
const nestedBytes = (data: Uint8Array) => concat(u32be(data.length), data);
const nestedBigUint = (value: bigint) => nestedBytes(bigBytes(value));
const nestedList = (items: Uint8Array[]) => concat(u32be(items.length), ...items);

export interface CallData {
  to: string;
  egld?: bigint;
  endpoint?: string | Uint8Array;
  args?: (string | Uint8Array)[];
}

const asBytes = (v: string | Uint8Array) => (typeof v === 'string' ? utf8(v) : v);

const callActionData = ({ to, egld = 0n, endpoint = '', args = [] }: CallData) =>
  concat(
    addressBytes(to),
    nestedBigUint(egld),
    nestedBytes(asBytes(endpoint)),
    nestedList(args.map((a) => nestedBytes(asBytes(a))))
  );

export type ActionSpec =
  | { kind: 'AddBoardMember' | 'AddProposer' | 'RemoveUser'; address: string }
  | { kind: 'ChangeQuorum'; quorum: number }
  | ({ kind: 'SendTransferExecute' | 'SendAsyncCall' } & CallData)
  | { kind: 'SCDeployFromSource'; amount?: bigint; source: string; codeMetadata?: Uint8Array; args?: (string | Uint8Array)[] }
  | { kind: 'SCUpgradeFromSource'; scAddress: string; amount?: bigint; source: string; codeMetadata?: Uint8Array; args?: (string | Uint8Array)[] };

const DISCRIMINANT: Record<ActionSpec['kind'], number> = {
  AddBoardMember: 1,
  AddProposer: 2,
  RemoveUser: 3,
  ChangeQuorum: 4,
  SendTransferExecute: 5,
  SendAsyncCall: 6,
  SCDeployFromSource: 7,
  SCUpgradeFromSource: 8
};

/** Nested encoding of the Action enum, as the contract stores and returns it. */
export const encodeAction = (spec: ActionSpec): Uint8Array => {
  const tag = Uint8Array.of(DISCRIMINANT[spec.kind]);
  switch (spec.kind) {
    case 'AddBoardMember':
    case 'AddProposer':
    case 'RemoveUser':
      return concat(tag, addressBytes(spec.address));
    case 'ChangeQuorum':
      return concat(tag, u32be(spec.quorum));
    case 'SendTransferExecute':
    case 'SendAsyncCall':
      return concat(tag, callActionData(spec));
    case 'SCDeployFromSource':
      return concat(
        tag,
        nestedBigUint(spec.amount ?? 0n),
        addressBytes(spec.source),
        spec.codeMetadata ?? Uint8Array.of(0x05, 0x00),
        nestedList((spec.args ?? []).map((a) => nestedBytes(asBytes(a))))
      );
    case 'SCUpgradeFromSource':
      return concat(
        tag,
        addressBytes(spec.scAddress),
        nestedBigUint(spec.amount ?? 0n),
        addressBytes(spec.source),
        spec.codeMetadata ?? Uint8Array.of(0x05, 0x00),
        nestedList((spec.args ?? []).map((a) => nestedBytes(asBytes(a))))
      );
  }
};

export interface PendingSpec {
  id: number;
  action: ActionSpec;
  signers?: string[];
}

/** One top-level ActionFullInfo, one entry of getPendingActionFullInfo's answer. */
export const encodeActionFullInfo = ({ id, action, signers = [] }: PendingSpec) =>
  concat(u32be(id), encodeAction(action), nestedList(signers.map(addressBytes)));

// --- the network, replaced -----------------------------------------------------

export interface ChainState {
  quorum: number;
  board: string[];
  proposers?: number;
  /** The proposers' addresses, for getAllProposers (added 7 Oct 2026). */
  proposerList?: string[];
  lastActionIndex?: number;
  pending: PendingSpec[];
  /** userRole answers by address, as discriminants: 0 none, 1 proposer, 2 board member. */
  roles?: Record<string, number>;
}

/** Answers a contract query the way the API would, from a described chain state. */
export const queryAnswer = (state: ChainState, fn: string, args: Uint8Array[] = []): Uint8Array[] => {
  switch (fn) {
    case 'getQuorum':
      return [bigBytes(BigInt(state.quorum))];
    case 'getNumBoardMembers':
      return [bigBytes(BigInt(state.board.length))];
    case 'getNumProposers':
      return [bigBytes(BigInt(state.proposers ?? 0))];
    case 'getActionLastIndex':
      return [bigBytes(BigInt(state.lastActionIndex ?? Math.max(0, ...state.pending.map((p) => p.id))))];
    case 'getAllBoardMembers':
      return state.board.map(addressBytes);
    case 'getAllProposers':
      return (state.proposerList ?? []).map(addressBytes);
    case 'getPendingActionFullInfo':
      return state.pending.map(encodeActionFullInfo);
    case 'userRole': {
      const who = new Address(args[0]).toBech32();
      return [bigBytes(BigInt(state.roles?.[who] ?? 0))];
    }
    case 'getActionValidSignerCount': {
      const id = Number(BigInt('0x' + (Buffer.from(args[0]).toString('hex') || '0')));
      const action = state.pending.find((p) => p.id === id);
      const valid = (action?.signers ?? []).filter((s) => state.board.includes(s)).length;
      return [bigBytes(BigInt(valid))];
    }
    case 'quorumReached': {
      const id = Number(BigInt('0x' + (Buffer.from(args[0]).toString('hex') || '0')));
      const action = state.pending.find((p) => p.id === id);
      const valid = (action?.signers ?? []).filter((s) => state.board.includes(s)).length;
      return [valid >= state.quorum ? Uint8Array.of(1) : new Uint8Array(0)];
    }
    default:
      throw new Error(`fixture has no answer for ${fn}`);
  }
};

/**
 * The replacement for multisig/network. Tests install it with
 *   jest.mock('multisig/network', () => require('./fixtures').networkMock);
 * and point it at a chain state with `useChain(state)`. The shipped reads.ts
 * then decodes real bytes through the real SDK and the real ABI.
 */
let chain: ChainState = { quorum: 2, board: [ALICE, BOB, CAROL], pending: [] };
// What the API knows about the tokens these tests use, as the real API does:
// the fix looks decimals up instead of assuming 18 (added with the DISP fixes,
// 7 Oct 2026). Collections (anything moved with a nonce) carry a type.
type Meta = { decimals: number; ticker?: string; name?: string; balance?: string; type?: string };
const KNOWN_TOKENS: Record<string, Meta> = {
  'WEGLD-a28c59': { decimals: 18, ticker: 'WEGLD', name: 'WrappedEGLD' },
  'FOXSY-5d5f3e': { decimals: 18, ticker: 'FOXSY', name: 'Foxsy' },
  'LKMEX-aab910': { decimals: 18, ticker: 'LKMEX', name: 'LockedMEX', type: 'MetaESDT' }
};
let tokenMeta: Record<string, Meta> = { ...KNOWN_TOKENS };
// What the safe HOLDS is only what a test says, never the known tokens above.
let heldTokens: Record<string, Meta> = {};
export const useChain = (state: ChainState) => {
  chain = state;
};
/** What the API knows about tokens (GET /tokens/{id}), on top of the known ones. */
export const useTokens = (tokens: Record<string, Meta>) => {
  tokenMeta = { ...KNOWN_TOKENS, ...tokens };
  heldTokens = tokens;
};

export const networkMock = {
  networkName: 'devnet',
  apiUrl: 'https://devnet-api.multiversx.com',
  chainId: 'D',
  explorerUrl: 'https://devnet-explorer.multiversx.com',
  clearCache: () => {},
  forget: () => {},
  // Mirrors multisig/network: a refused or lost read, as opposed to an answer.
  isTransient: (error: any) =>
    /\b(429|502|503|504)\b|Too Many Requests|timeout|timed out|Network|Failed to fetch/i.test(
      String(error?.message ?? error ?? '')
    ),
  cached: async <T>(_key: string, work: () => Promise<T>) => work(),
  api: async (path: string) => {
    const collection = path.match(/^\/collections\/([^/?]+)/);
    if (collection) {
      const meta = tokenMeta[collection[1]];
      if (!meta?.type) throw new Error(`${path} answered 404`);
      return { collection: collection[1], ticker: meta.ticker, type: meta.type, decimals: meta.decimals };
    }
    const token = path.match(/^\/tokens\/([^/?]+)/);
    if (token) {
      const meta = tokenMeta[token[1]];
      if (!meta) throw new Error(`${path} answered 404`);
      return { identifier: token[1], ticker: meta.ticker ?? token[1].split('-')[0], name: meta.name ?? token[1], decimals: meta.decimals };
    }
    const accountTokens = path.match(/^\/accounts\/[^/]+\/tokens/);
    if (accountTokens) {
      return Object.entries(heldTokens).map(([identifier, meta]) => ({ identifier, ticker: meta.ticker ?? identifier.split('-')[0], name: meta.name ?? identifier, balance: meta.balance ?? '0', decimals: meta.decimals }));
    }
    if (path.startsWith('/economics')) return { price: 0 };
    if (/^\/accounts\/[^/?]+(\?|$)/.test(path)) return { balance: '0', username: undefined };
    if (path.match(/\/nfts\/count/)) return 0;
    if (path.match(/\/transactions/)) return [];
    throw new Error(`fixture has no answer for ${path}`);
  },
  networkProvider: {
    queryContract: async (query: { function: string; arguments?: Uint8Array[] }) => ({
      function: query.function,
      returnCode: 'ok',
      returnMessage: '',
      returnDataParts: queryAnswer(chain, query.function, query.arguments ?? [])
    }),
    getAccount: async () => ({ nonce: 0n, balance: 0n })
  }
};

// --- recorded answers from the devnet contracts --------------------------------
//
// recorded-devnet.json holds the base64 returnData of the audit safes' views as the
// API returned them (devnet/record.mjs in the audit folder). With useRecorded the
// mock answers from those bytes, so a test runs on genuine contract output.

export interface RecordedSafe {
  address: string;
  getQuorum: string[];
  getAllBoardMembers: string[];
  getNumProposers: string[];
  getActionLastIndex: string[];
  getPendingActionFullInfo: string[];
  [view: string]: unknown;
}

let recorded: RecordedSafe | null = null;
export const useRecorded = (safe: RecordedSafe | null) => {
  recorded = safe;
};

/** Views that answer with an error (a 429 after the retries, a timeout, a node that is down). */
let failing = new Set<string>();
export const useFailing = (views: string[]) => {
  failing = new Set(views);
};

/** Views that answer late, as on a slow connection or a busy API. */
let delayed: { views: Set<string>; ms: number } = { views: new Set(), ms: 0 };
export const useDelay = (views: string[], ms: number) => {
  delayed = { views: new Set(views), ms };
};

const fromBase64 = (parts: string[]) => parts.map((p) => Uint8Array.from(Buffer.from(p, 'base64')));

const recordedAnswer = (safe: RecordedSafe, fn: string, args: Uint8Array[]): Uint8Array[] | null => {
  if (Array.isArray(safe[fn])) return fromBase64(safe[fn] as string[]);
  if (args.length === 1) {
    const id = Buffer.from(args[0]).toString('hex') === '' ? 0 : parseInt(Buffer.from(args[0]).toString('hex'), 16);
    const keyed = safe[`${fn}_${id}`];
    if (Array.isArray(keyed)) return fromBase64(keyed as string[]);
  }
  return null;
};

const queryContractOriginal = networkMock.networkProvider.queryContract;
networkMock.networkProvider.queryContract = async (query: { function: string; arguments?: Uint8Array[] }) => {
  if (failing.has(query.function)) throw new Error(`${query.function} answered 429`);
  if (delayed.views.has(query.function)) await new Promise((r) => setTimeout(r, delayed.ms));
  if (recorded) {
    const parts = recordedAnswer(recorded, query.function, query.arguments ?? []);
    if (parts) return { function: query.function, returnCode: 'ok', returnMessage: '', returnDataParts: parts };
    if (query.function === 'userRole') return { function: query.function, returnCode: 'ok', returnMessage: '', returnDataParts: [new Uint8Array(0)] };
    throw new Error(`no recorded answer for ${query.function}`);
  }
  return queryContractOriginal(query);
};
