// Types for vesting.js, which stays JavaScript so the devnet rehearsal imports
// exactly what the app ships.
import type { Transaction } from '@multiversx/sdk-core';
import type { CallContext } from './legacyCalls';

/** The one mvxvest a network may be called as. */
export interface VestingPin {
  address: string;
  /** Code hashes of the releases accepted, 64 hex characters each. */
  codeHashes: string[];
  claimKey: string;
  cancelKey: string;
}

/** What was read on chain when a vesting is proposed or signed. */
export interface VestingFacts {
  /** The code hash mvxvest's address runs today, or null when unread. */
  codeHash: string | null;
  creationPaused: boolean;
  claimKeyIssued: boolean;
  cancelKeyIssued: boolean;
  /** EGLD per vesting, in base units. */
  fee: bigint;
  /** Basis points of each vesting, in its own token. */
  tokenFeeBps: number;
  /** The collections mvxvest reports, when read: they must be the pinned ones. */
  claimKeyCollection?: string;
  cancelKeyCollection?: string;
  /** Beneficiaries that are contracts and were read as payable by contracts. */
  payableContracts?: string[];
  /** Whether a contract can send the safe tokens without a call: the keys and refunds. */
  safePayableBySc: boolean;
  /** What the safe holds of the token, in base units; unchecked when absent. */
  safeBalance?: bigint | null;
  /** The safe's EGLD in base units; unchecked when absent. */
  safeEgld?: bigint | null;
}

export interface Tranche {
  time: number;
  amount: bigint;
}

export type Curve =
  | { kind: 'tranches'; tranches: Tranche[] }
  | { kind: 'linear' }
  | { kind: 'stepped'; interval: number };

export interface Schedule {
  start: number;
  cliff: number;
  cliffAmount: bigint;
  end: number;
  curve: Curve;
}

export interface NewVesting {
  beneficiary: string;
  schedule: Schedule;
  /** Needed for a linear or stepped schedule; a tranche schedule adds up its own. */
  total?: bigint;
}

export interface VestingEntry {
  beneficiary: string;
  total: bigint;
  schedule: Schedule;
}

export interface VestingBatch {
  cancelable: boolean;
  label: string;
  entries: VestingEntry[];
}

export type DecodedBatch = VestingBatch | { error: string };

export interface Payment {
  token: string;
  nonce: bigint;
  amount: bigint;
}

export type VestingCall =
  | {
      kind: 'create';
      fn: 'createBatch' | 'create';
      contract: string;
      payments: Payment[];
      batch: DecodedBatch;
    }
  | {
      kind: 'cancel';
      contract: string;
      keys: Payment[];
      unexpectedArguments?: number;
    };

export interface VestingInput {
  pin: VestingPin | null;
  facts: VestingFacts;
  token: string;
  cancelable: boolean;
  label: string;
  entries: NewVesting[];
  /** The token's decimals, to say amounts in its units. */
  decimals?: number;
  /** Seconds; the dates must be after it. Defaults to now. */
  now?: number;
}

export declare const mvxvestAbi: any;
export declare const mvxvestFor: (network: string) => VestingPin | null;
export declare const VESTING_LIMITS: {
  batch: number;
  contractBatch: number;
  batchCancelable: number;
  tranches: number;
  labelBytes: number;
  horizonSeconds: number;
};
export declare const trancheSchedule: (
  tranches: { time: number; amount: bigint }[]
) => Schedule;
export declare const scheduleFromNative: (native: any) => Schedule;
export declare const entryTotal: (entry: NewVesting) => bigint;
export declare const encodeCreateBatchArgs: (batch: {
  cancelable: boolean;
  label: string;
  entries: NewVesting[];
}) => Uint8Array[];
export declare const encodeCreateArgs: (batch: {
  cancelable: boolean;
  label: string;
  entries: NewVesting[];
}) => Uint8Array[];
export declare const decodeCreateBatchArgs: (
  args: Uint8Array[]
) => VestingBatch & { error?: string };
export declare const decodeCreateArgs: (
  args: Uint8Array[]
) => VestingBatch & { error?: string };
export declare const formatRawAmount: (
  raw: bigint,
  decimals?: number | null
) => string;
export declare const tokenFeeOf: (total: bigint, bps: number) => bigint;
export declare const vestingPayment: (
  entries: NewVesting[],
  fees?: { fee?: bigint; tokenFeeBps?: number }
) => { sum: bigint; tokenFee: bigint; egldFee: bigint; tokenAmount: bigint };
export declare const trancheGas: (tranches: number) => bigint;
export declare const actionReadGas: (actionBytes: number) => bigint;
export declare const vestingGasNeed: (input: {
  entries: NewVesting[];
  cancelable: boolean;
  feesPaid: boolean;
  actionBytes?: number;
}) => bigint;
export declare const cancelGasNeed: (tranches: number) => bigint;
export declare const CANCEL_GAS_NEED: bigint;
export type IssueKind = 'refused' | 'shape' | 'contract' | 'past';
export declare const entryIssues: (
  entry: NewVesting,
  at: number,
  context: {
    safe: string;
    pin: VestingPin | null;
    now: number;
    payableContracts?: string[];
    format?: (raw: bigint) => string;
  }
) => { kind: IssueKind; text: string }[];
export declare const batchActionBytes: (input: {
  pin: VestingPin;
  safe: string;
  token: string;
  cancelable: boolean;
  label: string;
  entries: NewVesting[];
  facts: VestingFacts;
}) => number;
export declare const actionBytesOf: (
  to: string,
  egld: bigint,
  parts: Uint8Array[]
) => number;
export declare const vestingProblem: (
  input: VestingInput & { safe: string }
) => string;
export declare const vestingContractProblem: (
  pin: VestingPin | null,
  facts: VestingFacts | null
) => string;
export declare const keyIdentifier: (
  collection: string,
  nonce: number | bigint
) => string;
export declare const cancelProblem: (input: {
  pin: VestingPin | null;
  facts: VestingFacts;
  collection: string;
  nonce: number;
}) => string;
export declare const buildProposeVestings: (
  c: CallContext,
  input: VestingInput
) => Promise<Transaction>;
export declare const buildProposeCancelVesting: (
  c: CallContext,
  input: {
    pin: VestingPin | null;
    facts: VestingFacts;
    collection: string;
    nonce: number;
  }
) => Promise<Transaction>;
export declare const readVestingCall: (call: {
  to: string;
  egld?: bigint;
  endpoint: string | Uint8Array;
  args: Uint8Array[];
  safe: string;
}) => VestingCall | null;
