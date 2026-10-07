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
export declare const DEFAULT_GAS: bigint;
export declare const toRawAmount: (amount: string | number, decimals: number) => bigint;
export declare const buildSign: (c: CallContext, actionId: number) => Promise<Transaction>;
export declare const buildUnsign: (c: CallContext, actionId: number) => Promise<Transaction>;
export declare const buildPerform: (c: CallContext, actionId: number) => Promise<Transaction>;
export declare const buildDiscard: (c: CallContext, actionId: number) => Promise<Transaction>;
export declare const buildProposeEgld: (
  c: CallContext,
  options: { to: string; amount: string; functionName?: string; functionArgs?: string[] }
) => Promise<Transaction>;
export declare const buildProposeToken: (
  c: CallContext,
  options: { to: string; tokenIdentifier: string; amount: string; decimals: number }
) => Promise<Transaction>;
export declare const buildProposeAddBoardMember: (c: CallContext, address: string) => Promise<Transaction>;
export declare const buildProposeAddProposer: (c: CallContext, address: string) => Promise<Transaction>;
export declare const buildProposeRemoveUser: (c: CallContext, address: string) => Promise<Transaction>;
export declare const buildProposeChangeQuorum: (c: CallContext, newQuorum: number) => Promise<Transaction>;

export declare const MULTISIG_CODE_HASH: string;
export declare const MULTISIG_WASM_SHA256: string;
export declare const DEPLOY_GAS: bigint;
export declare const HANDOVER_GAS: bigint;
export declare const predictSafeAddress: (deployer: string, nonce: number | bigint) => string;
export declare const buildDeploySafe: (
  c: Omit<CallContext, 'safe'>,
  options: { bytecode: Uint8Array; quorum: number; board: string[] }
) => Promise<Transaction>;
export declare const buildHandOver: (c: CallContext) => Promise<Transaction>;
