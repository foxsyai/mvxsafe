/**
 * @jest-environment node
 *
 * VBD-02 (medium): a beneficiary that is a smart contract passes
 * vestingProblem, and when that contract cannot receive tokens from
 * contracts the carry-out fails after the signatures, or the claim key is
 * stranded.
 *
 * mvxvest sends every claim key to its beneficiary with a plain transfer
 * (create.rs, deliver_keys). To a contract that is not "payable by smart
 * contracts" that transfer is refused by the network. Proven on devnet by
 * simulation, 6 Nov 2026 (proofs/VBD-02.mjs): createBatch on a v4 copy in
 * shard 1 with such a contract in shard 1 as the beneficiary answers "sending
 * value to non payable contract", cancelable or not, while the same batch to a
 * wallet or to a contract that is payable by contracts (a safe) simulates
 * fine. So:
 *
 *   - with mvxvest in the safe's shard, the whole createBatch fails, the
 *     tokens come back and the action is used up with every signature;
 *   - with mvxvest in another shard, the simulation passes in the safe's
 *     shard, the vesting IS created and the key bounces back to mvxvest, where
 *     only mvxvest's owner can send it on (mvxvest's guide, "Smart contracts as
 *     beneficiaries"): the tokens are locked for a beneficiary who cannot
 *     claim, and a non-cancelable vesting stays that way.
 *
 * mvxvest's own dapp singles out contract beneficiaries by the shape of the
 * address (dapp/src/pages/Create.tsx, "red team RT9"). mvxsafe's shared gate
 * has no rule for them: a pasted address that is a contract goes through like
 * a wallet. On mainnet mvxvest is in shard 0.
 *
 * Correct behaviour, asserted here: a beneficiary that is a smart contract is
 * refused by vestingProblem unless the facts read on chain say it can receive
 * tokens from contracts; with no such fact it is refused, and the message
 * names the vesting and says it is a contract. A wallet is accepted as before.
 */
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  buildProposeVestings,
  NewVesting,
  trancheSchedule,
  VestingFacts,
  VestingPin,
  vestingProblem
} from 'multisig/vesting';

const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf';
const COPY = 'erd1qqqqqqqqqqqqqpgq47urq5rmd2x54tp638hejcm5uyn9t6ymaujqqxf98a';
const WALLET = 'erd1vsfzda20hmvjc7f7mymvyff5gusql04yug2ehtchrdalj2dad85q3685a5';
const PROPOSER =
  'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
// A contract address nobody deployed: its shape alone says "contract".
const CONTRACT = predictSafeAddress(WALLET, 123456);
const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 18n;
const FIRST = 1793961456;

const pin: VestingPin = {
  address: COPY,
  codeHashes: [V4],
  claimKey: 'VESTKEY-2a3443',
  cancelKey: 'VESTCANCEL-2affd9'
};
const facts: VestingFacts = {
  codeHash: V4,
  creationPaused: false,
  claimKeyIssued: true,
  cancelKeyIssued: true,
  fee: 0n,
  tokenFeeBps: 0,
  safePayableBySc: true,
  safeBalance: 1000n * UNIT,
  safeEgld: UNIT
};
const context = { chainId: 'D', sender: PROPOSER, nonce: 7, safe: SAFE };
const to = (beneficiary: string): NewVesting[] => [
  {
    beneficiary: WALLET,
    schedule: trancheSchedule([{ time: FIRST, amount: UNIT }])
  },
  {
    beneficiary,
    schedule: trancheSchedule([{ time: FIRST, amount: UNIT }])
  }
];
const batch = (beneficiary: string) => ({
  pin,
  facts,
  safe: SAFE,
  token: 'TSAFED-e52b18',
  cancelable: true,
  label: 'grants',
  entries: to(beneficiary),
  now: FIRST - 600
});

describe('VBD-02: a beneficiary that is a smart contract', () => {
  it('control: a wallet is accepted', async () => {
    expect(vestingProblem(batch(WALLET))).toBe('');
    await expect(
      buildProposeVestings(context, batch(WALLET))
    ).resolves.toBeDefined();
  });

  it('control: the shape test tells a contract from a wallet', () => {
    expect(CONTRACT.startsWith('erd1qqqqqqqqqqqqqpgq')).toBe(true);
  });

  it('is refused by vestingProblem when nothing read on chain says it can receive tokens from contracts', () => {
    const problem = vestingProblem(batch(CONTRACT));
    expect(problem).not.toBe('');
    expect(problem).toMatch(/Vesting 2/);
    expect(problem).toMatch(/contract/i);
  });

  it('is refused by the builder', async () => {
    await expect(
      buildProposeVestings(context, batch(CONTRACT))
    ).rejects.toThrow(/contract/i);
  });
});
