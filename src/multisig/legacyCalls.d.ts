// Types for the plain JavaScript builders, which stay JavaScript so the devnet
// tests can import exactly what the app ships.
import type { Transaction } from '@multiversx/sdk-core';

export interface CallContext {
  chainId: string;
  sender: string;
  nonce: number;
  safe: string;
}

export declare const legacyAbi: any;
export declare const toRawAmount: (
  amount: string | number,
  decimals: number
) => bigint;
export declare const normalizeBech32: (value: unknown) => string;
export declare const parseAddress: (
  value: string,
  what?: string
) => import('@multiversx/sdk-core').Address;
export declare const buildSign: (
  c: CallContext,
  actionId: number
) => Promise<Transaction>;
export declare const buildUnsign: (
  c: CallContext,
  actionId: number
) => Promise<Transaction>;
export declare const buildPerform: (
  c: CallContext,
  actionId: number
) => Promise<Transaction>;
export declare const buildDiscard: (
  c: CallContext,
  actionId: number
) => Promise<Transaction>;
export declare const buildProposeEgld: (
  c: CallContext,
  options: {
    to: string;
    amount: string;
    functionName?: string;
    functionArgs?: string[];
  }
) => Promise<Transaction>;
export declare const buildProposeToken: (
  c: CallContext,
  options: {
    to: string;
    tokenIdentifier: string;
    amount: string;
    decimals: number;
  }
) => Promise<Transaction>;
export declare const buildProposeAddBoardMember: (
  c: CallContext,
  address: string
) => Promise<Transaction>;
export declare const buildProposeAddProposer: (
  c: CallContext,
  address: string
) => Promise<Transaction>;
export declare const buildProposeRemoveUser: (
  c: CallContext,
  address: string
) => Promise<Transaction>;
export declare const buildProposeChangeQuorum: (
  c: CallContext,
  newQuorum: number
) => Promise<Transaction>;

export interface CodeMetadataFlags {
  upgradeable: boolean;
  readable: boolean;
  payable: boolean;
  payableBySc: boolean;
}

/** One argument of a call: how it is written, and what was typed. */
export type ArgumentKind =
  'egld' | 'number' | 'address' | 'text' | 'hex' | 'bool';
export interface TypedArgument {
  kind: ArgumentKind;
  value: string;
}

export declare const shardOf: (address: string) => number;
export declare const codeHashOf: (bytes: Uint8Array) => string;
export declare const normalizeCodeHash: (value: string) => string | null;
export declare const metadataFromHex: (hex: string) => CodeMetadataFlags;
export declare const metadataToHex: (
  flags: Partial<CodeMetadataFlags>
) => string;
export declare const topEncode: (raw: bigint) => Uint8Array;
export declare const encodeArgument: (
  kind: ArgumentKind,
  value: string
) => Uint8Array;
export declare const buildProposeCall: (
  c: CallContext,
  options: {
    to: string;
    egld?: string;
    functionName: string;
    args?: (TypedArgument | Uint8Array)[];
  }
) => Promise<Transaction>;
export declare const upgradeProblem: (options: {
  safe: string;
  target: string;
  source: string;
  metadata: CodeMetadataFlags | string;
}) => string;
export declare const buildProposeUpgrade: (
  c: CallContext,
  options: {
    target: string;
    source: string;
    metadata: CodeMetadataFlags | string;
    args?: (TypedArgument | Uint8Array)[];
    amount?: string;
  }
) => Promise<Transaction>;
export declare const buildDeploySource: (
  c: Omit<CallContext, 'safe'>,
  options: { bytecode: Uint8Array; args?: (TypedArgument | Uint8Array)[] }
) => Promise<Transaction>;

export declare const PROTOCOL_BUILTINS: Set<string>;
export declare const MAX_ARGUMENT_BYTES: number;
export declare const builtInRefusal: (name: string) => string;
export declare const isSystemContract: (address: string) => boolean;

export declare const MULTISIG_CODE_HASH: string;
export declare const MULTISIG_WASM_SHA256: string;
export declare const predictSafeAddress: (
  deployer: string,
  nonce: number | bigint
) => string;
export declare const buildDeploySafe: (
  c: Omit<CallContext, 'safe'>,
  options: { bytecode: Uint8Array; quorum: number; board: string[] }
) => Promise<Transaction>;
export declare const buildHandOver: (c: CallContext) => Promise<Transaction>;
