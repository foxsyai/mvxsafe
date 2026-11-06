// An account as the card and the forms check it: shard, owner, code hash (the
// code hashed here, not the API's word, EXT-01), size, metadata and balance.
// On its own so the vesting reads can use it without importing the card's
// checks, which use them.

import { MetadataFlags } from './describe';
import { codeHashOf, normalizeCodeHash, shardOf } from './legacyCalls';
import { api } from './network';
import { wasmFunctionExports } from './wasmExports';

export interface AccountFacts {
  address: string;
  shard: number;
  ownerAddress: string;
  /**
   * 64 hex characters, or null when the address holds no code: the hash of
   * the code the API returned, or the hash it states when it returned none.
   * Then codeUnread is true, and the hash is only the API's word.
   */
  codeHash: string | null;
  /** The API stated a hash that is not the hash of the code it returned. */
  codeHashMismatch?: boolean;
  /**
   * The API stated a code hash but returned no code that could be hashed
   * (missing, empty, odd length, not hex): the hash is unverified and the size
   * unknown. Nothing may be called a match on it (found by the mvxvest side,
   * 23 Oct 2026).
   */
  codeUnread: boolean;
  /** Size of the code in bytes, 0 when unknown. */
  codeBytes: number;
  /**
   * Whether the code has an `upgrade` function, which is what an upgrade from
   * it runs. Null when the code was not read or is not well-formed wasm.
   */
  exportsUpgrade: boolean | null;
  /** Null for an account without code, or when the API did not say. */
  metadata: MetadataFlags | null;
  balance: bigint;
}

interface AccountResponse {
  shard?: number;
  ownerAddress?: string;
  codeHash?: string;
  code?: string;
  balance?: string;
  isUpgradeable?: boolean;
  isReadable?: boolean;
  isPayable?: boolean;
  isPayableBySmartContract?: boolean;
}

/**
 * Shard, owner, code hash (as hex: the API gives base64), code size and code
 * metadata of an address. The shard comes from the address itself, which is
 * where the network puts it; the API's own figure only has to agree.
 */
export const readAccountFacts = async (
  address: string
): Promise<AccountFacts> => {
  const account = await api<AccountResponse>(`/accounts/${address}`);
  const stated = account?.codeHash ? normalizeCodeHash(account.codeHash) : null;
  // The code itself, hashed here: the stated hash is only the API's word for
  // it, and a signer compares it with the release (EXT-01, 21 Oct 2026).
  const code =
    typeof account?.code === 'string' &&
    account.code.length > 0 &&
    account.code.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(account.code)
      ? Uint8Array.from(account.code.match(/../g) as string[], (pair) =>
          parseInt(pair, 16)
        )
      : null;
  const hashed = stated && code ? codeHashOf(code) : null;
  const codeHash = hashed ?? stated;
  const exported = hashed && code ? wasmFunctionExports(code) : null;
  return {
    address,
    shard: shardOf(address),
    ownerAddress: account?.ownerAddress ?? '',
    codeHash,
    codeHashMismatch: Boolean(hashed && stated && hashed !== stated),
    codeUnread: Boolean(stated && !hashed),
    // The size of the code that was hashed, or 0 (unknown): a code never read
    // gave a size, and with it a gas budget called measured (review of PR #17).
    codeBytes: hashed && code ? code.length : 0,
    exportsUpgrade: exported ? exported.includes('upgrade') : null,
    metadata:
      codeHash && typeof account?.isUpgradeable === 'boolean'
        ? {
            upgradeable: Boolean(account.isUpgradeable),
            readable: Boolean(account.isReadable),
            payable: Boolean(account.isPayable),
            payableBySc: Boolean(account.isPayableBySmartContract)
          }
        : null,
    balance: BigInt(account?.balance ?? '0')
  };
};
