// What the vesting actions read from mvxvest and the safe, at the moment a
// batch or a cancel is proposed and again when its card is signed. Nothing
// here signs or sends anything: views on the contract and GETs on the API.

import { Address, SmartContractController } from '@multiversx/sdk-core';
import { readAccountFacts } from './accountFacts';
import { api, cached, chainId, networkName, networkProvider } from './network';
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

// Every view goes through the app's queue, which paces reads and pauses on a
// 429 (audit VFM-05): thirty keys must not fire sixty queries at once. Each
// key is new, so nothing is answered from the cache: a fee, a pause or a
// cancel must be read as it is now.
let viewsAsked = 0;
const view = async (pin: VestingPin, fn: string, args: any[] = []) =>
  cached(`mvxvest:${pin.address}:${fn}:${args.join(',')}:${++viewsAsked}`, () =>
    controller.query({
      contract: Address.newFromBech32(pin.address),
      function: fn,
      arguments: args
    })
  );

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

const TOKEN_ID = /^[A-Z0-9]{3,10}-[0-9a-f]{6}$/;

/**
 * Of these beneficiaries, the contracts the API says are payable by
 * contracts: mvxvest's claim key reaches them (audit VBD-02). A wallet needs
 * no read; a contract that could not be read is not counted.
 */
export const readPayableContracts = async (
  pin: VestingPin,
  safe: string,
  beneficiaries: string[]
) => {
  const contracts = [...new Set(beneficiaries)].filter((address) => {
    try {
      return (
        address !== safe &&
        address !== pin.address &&
        Address.newFromBech32(address).isSmartContract()
      );
    } catch {
      return false;
    }
  });
  const answers = await Promise.all(
    contracts.map((address) =>
      api<AccountResponse>(`/accounts/${address}`).then(
        (account) => (account?.isPayableBySmartContract ? address : ''),
        () => ''
      )
    )
  );
  return answers.filter(Boolean);
};

/**
 * Everything vestingProblem needs, read now: the code mvxvest runs (hashed
 * here from the code itself, EXT-01), whether it creates, its keys and fees,
 * and what the safe holds and can receive.
 */
export const readVestingFacts = async (
  pin: VestingPin,
  safe: string,
  token?: string,
  beneficiaries: string[] = []
): Promise<VestingFacts> => {
  // Only a well-formed identifier goes into a path (as readTokenMeta does).
  const tokenId = token && TOKEN_ID.test(token) ? token : '';
  const [
    contract,
    account,
    paused,
    claimKey,
    cancelKey,
    fee,
    bps,
    holding,
    payableContracts
  ] = await Promise.all([
    readAccountFacts(pin.address),
    api<AccountResponse>(`/accounts/${safe}`),
    view(pin, 'isCreationPaused'),
    view(pin, 'getClaimKeyCollection'),
    view(pin, 'getCancelKeyCollection'),
    view(pin, 'getFee'),
    view(pin, 'getTokenFee'),
    tokenId
      ? api<{ balance?: string }>(`/accounts/${safe}/tokens/${tokenId}`).catch(
          () => ({ balance: '0' })
        )
      : Promise.resolve(token ? { balance: '0' } : null),
    readPayableContracts(pin, safe, beneficiaries)
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
    payableContracts,
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
  /** Null when mvxvest has no vesting for this key, or when it could not be read. */
  vesting: VestingState | null;
  /** True when the vesting could not be read just now: not a fact about mvxvest (VFM-02). */
  unread?: boolean;
}

/** Every key read, and whether the API's window ended the list. */
export type HeldCancelKeyList = HeldCancelKey[] & { more?: boolean };

/** One page of the API, and the most it serves in all (from + size <= 10,000). */
const KEYS_PAGE = 1000;
const KEYS_WINDOW = 10000;

/**
 * The pinned mvxvest's cancel keys this safe holds, every one of them (audits
 * VFM-01, VCD-04: a safe that created more than 100 cancelable vestings holds
 * more than 100 keys), each with its vesting. `more` is true when the API's
 * window of 10,000 was reached.
 */
export const readHeldCancelKeys = async (
  pin: VestingPin,
  safe: string
): Promise<HeldCancelKeyList> => {
  const nfts: { identifier: string; nonce: number }[] = [];
  let more = false;
  for (let from = 0; from < KEYS_WINDOW; from += KEYS_PAGE) {
    const page =
      (await api<{ identifier: string; nonce: number }[]>(
        `/accounts/${safe}/nfts?collections=${pin.cancelKey}&from=${from}&size=${KEYS_PAGE}`
      )) ?? [];
    nfts.push(...page);
    if (page.length < KEYS_PAGE) break;
    if (from + KEYS_PAGE >= KEYS_WINDOW) more = true;
  }
  const keys: HeldCancelKeyList = await Promise.all(
    nfts.map(async (nft) => {
      try {
        return {
          identifier: nft.identifier,
          nonce: Number(nft.nonce),
          vesting: await readVestingOfCancelKey(pin, Number(nft.nonce))
        };
      } catch {
        return {
          identifier: nft.identifier,
          nonce: Number(nft.nonce),
          vesting: null,
          unread: true
        };
      }
    })
  );
  if (more) keys.more = true;
  return keys;
};
