// What the vesting actions read from mvxvest and the safe, at the moment a
// batch or a cancel is proposed and again when its card is signed. Nothing
// here signs or sends anything: views on the contract and GETs on the API.

import { Address, SmartContractController } from '@multiversx/sdk-core';
import { readAccountFacts } from './accountFacts';
import { api, chainId, networkName, networkProvider } from './network';
import {
  mvxvestAbi,
  mvxvestFor,
  Schedule,
  scheduleFromNative,
  VestingFacts,
  VestingPin
} from './vesting';

const controller = new SmartContractController({
  chainID: chainId,
  networkProvider,
  abi: mvxvestAbi
});

const view = async (pin: VestingPin, fn: string, args: any[] = []) =>
  controller.query({
    contract: Address.newFromBech32(pin.address),
    function: fn,
    arguments: args
  });

const big = (value: any): bigint =>
  BigInt(value?.toFixed ? value.toFixed() : String(value ?? '0'));
const num = (value: any): number => Number(big(value));
const text = (value: any): string =>
  typeof value === 'string'
    ? value
    : new TextDecoder().decode(value ?? new Uint8Array(0));
const bech32 = (value: any): string =>
  typeof value?.toBech32 === 'function' ? value.toBech32() : String(value);

/** The mvxvest this site's network pins, or null where there is none. */
export const pinnedMvxvest = (): VestingPin | null => mvxvestFor(networkName);

interface AccountResponse {
  balance?: string;
  isPayableBySmartContract?: boolean;
}

/**
 * Everything vestingProblem needs, read now: the code mvxvest runs (hashed
 * here from the code itself, EXT-01), whether it creates, its keys and fees,
 * and what the safe holds and can receive.
 */
export const readVestingFacts = async (
  pin: VestingPin,
  safe: string,
  token?: string
): Promise<VestingFacts> => {
  const [contract, account, paused, claimKey, cancelKey, fee, bps, holding] =
    await Promise.all([
      readAccountFacts(pin.address),
      api<AccountResponse>(`/accounts/${safe}`),
      view(pin, 'isCreationPaused'),
      view(pin, 'getClaimKeyCollection'),
      view(pin, 'getCancelKeyCollection'),
      view(pin, 'getFee'),
      view(pin, 'getTokenFee'),
      token
        ? api<{ balance?: string }>(`/accounts/${safe}/tokens/${token}`).catch(
            () => ({ balance: '0' })
          )
        : Promise.resolve(null)
    ]);
  const claimCollection = text(claimKey[0]);
  const cancelCollection = text(cancelKey[0]);
  return {
    // Only the API's word when it did not return the code: not accepted.
    codeHash: contract.codeUnread ? null : contract.codeHash,
    creationPaused: Boolean(paused[0]),
    claimKeyIssued: claimCollection !== '',
    cancelKeyIssued: cancelCollection !== '',
    claimKeyCollection: claimCollection || undefined,
    cancelKeyCollection: cancelCollection || undefined,
    fee: big(fee[0]),
    tokenFeeBps: num(bps[0]),
    safePayableBySc: Boolean(account?.isPayableBySmartContract),
    safeBalance: holding ? BigInt(holding.balance ?? '0') : null,
    safeEgld: BigInt(account?.balance ?? '0')
  };
};

/** One vesting as mvxvest reports it now (getVesting). */
export interface VestingState {
  id: number;
  creator: string;
  beneficiary: string;
  token: string;
  total: bigint;
  schedule: Schedule;
  cancelable: boolean;
  createdAt: number;
  claimNonce: number;
  cancelNonce: number;
  label: string;
  claimed: bigint;
  /** 0 while it runs. */
  cancelledAt: number;
  vested: bigint;
  claimable: bigint;
  finalAmount: bigint;
  refunded: bigint;
  /** The block time the figures are for. */
  timestamp: number;
}

export const vestingStateOf = (native: any): VestingState => {
  const vesting = native.vesting;
  return {
    id: num(native.id),
    creator: bech32(vesting.creator),
    beneficiary: bech32(vesting.beneficiary),
    token: text(vesting.token),
    total: big(vesting.total),
    schedule: scheduleFromNative(vesting.schedule),
    cancelable: Boolean(vesting.cancelable),
    createdAt: num(vesting.created_at),
    claimNonce: num(vesting.claim_nonce),
    cancelNonce: num(vesting.cancel_nonce),
    label: text(vesting.label),
    claimed: big(native.claimed),
    cancelledAt: num(native.cancelled_at),
    vested: big(native.vested),
    claimable: big(native.claimable),
    finalAmount: big(native.final_amount),
    refunded: big(native.refunded),
    timestamp: num(native.timestamp)
  };
};

/** The vesting a cancel key cancels, or null when mvxvest knows no such key. */
export const readVestingOfCancelKey = async (
  pin: VestingPin,
  nonce: number
): Promise<VestingState | null> => {
  const [id] = await view(pin, 'getVestingByCancelNonce', [nonce]);
  const vestingId = num(id);
  if (!vestingId) return null;
  const [state] = await view(pin, 'getVesting', [vestingId]);
  return state ? vestingStateOf(state) : null;
};

/** What a cancel now would do: what stays the beneficiary's, what comes back. */
export const cancelOutcome = (state: VestingState) => ({
  /** Vested, so it stays claimable with the claim key. */
  toBeneficiary: state.vested - state.claimed,
  alreadyClaimed: state.claimed,
  /** Not vested yet: paid back to whoever sends the cancel key. */
  toSafe: state.total - state.vested
});

export interface HeldCancelKey {
  identifier: string;
  nonce: number;
  /** Null when mvxvest has no vesting for this key. */
  vesting: VestingState | null;
}

/** The pinned mvxvest's cancel keys this safe holds, each with its vesting. */
export const readHeldCancelKeys = async (
  pin: VestingPin,
  safe: string
): Promise<HeldCancelKey[]> => {
  const nfts = await api<{ identifier: string; nonce: number }[]>(
    `/accounts/${safe}/nfts?collections=${pin.cancelKey}&size=100`
  );
  return Promise.all(
    (nfts ?? []).map(async (nft) => ({
      identifier: nft.identifier,
      nonce: Number(nft.nonce),
      vesting: await readVestingOfCancelKey(pin, Number(nft.nonce)).catch(
        () => null
      )
    }))
  );
};
