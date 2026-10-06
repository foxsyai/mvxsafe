// The Foxsy AI Foundation safes, preloaded so the app is useful on first open.
// Anyone can add their own by address; those live in local storage only
// (see lib/savedSafes.ts). Verified read-only against mainnet on 6 Oct 2026:
// all seven share one code hash, quorum 2 of 3, three board members, no proposers.
//
// IMPORTANT: this build of the multisig contract has NO groups and NO batches
// (getNumGroups does not exist on chain), so the UI must never offer signBatch,
// performBatch, discardBatch or proposeBatch.

export interface KnownSafe {
  name: string;
  address: string;
}

export const FOUNDATION_SAFES: KnownSafe[] = [
  {
    name: 'Treasury',
    address: 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p'
  },
  {
    name: 'Team',
    address: 'erd1qqqqqqqqqqqqqpgqt3kpgt5rfg9mrd3vpu6u6cxx758lkrgz0cqqcy9c32'
  },
  {
    name: 'Vesting',
    address: 'erd1qqqqqqqqqqqqqpgqjvg2qnd47xhyqwhemw304qu5zat7uxaz5m6q07rtdp'
  },
  {
    name: 'Ecosystem',
    address: 'erd1qqqqqqqqqqqqqpgqsm05k6e468xu065p2u46f938k2ee6l7nqvfq6xnmdh'
  },
  {
    name: 'Community',
    address: 'erd1qqqqqqqqqqqqqpgqz4v88tqd6j3ntxafg5ynyy8028vaf53rx0kqf5gnre'
  },
  {
    name: 'Liquidity',
    address: 'erd1qqqqqqqqqqqqqpgq3evw5eguak04xwqkkdwdsxynd4s2e32h0jasyh7958'
  },
  {
    name: 'Advisors',
    address: 'erd1qqqqqqqqqqqqqpgq27hwaxqf2gh2r7xqmldlvla6mjzc78lp98nqvuzq39'
  }
];

/** The token the Foundation holds, shown first in every balance list. */
export const PRIMARY_TOKEN = 'FOXSY-5d5f3e';
