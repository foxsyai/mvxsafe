// Types for gas.js, which stays JavaScript so the devnet rehearsal imports
// exactly what the app ships.
import type { Transaction } from '@multiversx/sdk-core';

export declare const GUARDIAN_GAS: bigint;
export declare const SAFE_OWN_GAS: bigint;
export declare const CALLBACK_GAS: bigint;
export declare const MAX_GAS: bigint;
export declare const UPGRADE_GAS_PER_BYTE: bigint;
export declare const UPGRADE_FIXED_GAS: bigint;
export declare const UNKNOWN_CALL_NEED: bigint;
export declare const TRANSFER_NEED: bigint;
export declare const withMargin: (gas: bigint | number) => bigint;
export declare const upgradeNeed: (codeBytes: number | bigint) => bigint;
export declare const performBudget: (need: bigint, callback?: bigint) => bigint;

export type PerformPlan =
  | { simulate: true }
  | {
      simulate: false;
      /** False when the need could not be measured and a default stands in. */
      known: boolean;
      need: bigint;
      gasLimit: bigint;
      /** True when a floor (MAINNET_UPGRADE_FLOOR) raised the limit above the budget. */
      raised: boolean;
      parts: { safe: bigint; call: bigint; callback: bigint };
    };
export declare const performPlan: (options: {
  name: string;
  codeBytes?: number;
  callNeed?: bigint | null;
  hasFunction?: boolean;
  floor?: bigint;
}) => PerformPlan;
export declare const MAINNET_UPGRADE_FLOOR: bigint;

export declare class GasError extends Error {
  /** True when the network answered and said no; false when it did not answer. */
  readonly refused: boolean;
  /** True when the network answered with no real figure (600,000,000). */
  unmeasured?: boolean;
  constructor(message: string, refused: boolean);
}

interface CostEstimator {
  estimateTransactionCost(
    transaction: Transaction
  ): Promise<{ gasLimit: number | bigint }>;
}

export declare const settleGas: (
  transaction: Transaction,
  options: {
    provider: CostEstimator;
    guardian?: string;
    budget?: bigint | null;
  }
) => Promise<Transaction>;
export declare const simulateAsSafe: (
  provider: CostEstimator,
  options: {
    chainId: string;
    safe: string;
    to: string;
    egld?: bigint;
    data: string | Uint8Array;
  }
) => Promise<bigint>;
export declare const isTrialFeeShortfall: (error: unknown) => boolean;
export declare const TOKEN_TRANSFER_GAS: bigint;
export declare const CHANGE_OWNER_GAS: bigint;
export declare const handOverGas: (dataLength: number) => bigint;
export declare const tokenTransferNeed: (data: string) => bigint | null;
export type MeasuredHow = 'tried' | 'token' | 'unmeasured' | 'fee' | 'offline';
export declare const measureCall: (
  provider: CostEstimator,
  options: {
    chainId: string;
    safe: string;
    to: string;
    egld?: bigint;
    data: string;
  }
) => Promise<{ need: bigint | null; how: MeasuredHow }>;
export declare const feeOf: (
  gasLimit: bigint,
  dataLength: number,
  guarded?: boolean
) => bigint;
