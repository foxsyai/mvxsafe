/**
 * @jest-environment node
 */
// Upgrading a contract the safe owns, and calling it (handoff from mvxvest, 13
// Oct 2026). The two data strings of the handoff are rebuilt byte for byte, one
// of them from a real devnet transaction, and the refusals that keep an
// upgrade from failing after its signatures are proven here.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Address, Transaction } from '@multiversx/sdk-core';
import {
  CALLBACK_GAS,
  feeOf,
  GasError,
  GUARDIAN_GAS,
  measureCall,
  performPlan,
  SAFE_OWN_GAS,
  settleGas,
  tokenTransferNeed,
  UNKNOWN_CALL_NEED,
  upgradeNeed,
  withMargin
} from 'multisig/gas';
import {
  buildDeploySource,
  buildProposeCall,
  buildProposeUpgrade,
  buildSign,
  codeHashOf,
  encodeArgument,
  metadataFromHex,
  metadataToHex,
  MULTISIG_CODE_HASH,
  normalizeCodeHash,
  predictSafeAddress,
  shardOf,
  upgradeProblem
} from 'multisig/legacyCalls';

const text = (data: Uint8Array) => Buffer.from(data).toString();
const fromHex = (hex: string) => Address.newFromHex(hex).toBech32();

// Mainnet, from the handoff.
const SAFE = 'erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3'; // shard 1
const MVXVEST =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu'; // shard 0
const BOARD_MEMBER =
  'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3'; // shard 1
const mainnet = { chainId: '1', sender: BOARD_MEMBER, nonce: 12, safe: SAFE };
// A contract in shard 1: what a shard-1 wallet deploys.
const SHARD1_SOURCE = predictSafeAddress(BOARD_MEMBER, 7);

describe('the two data strings of the handoff, byte for byte', () => {
  test('setFee 0.01 EGLD on mvxvest, typed as an EGLD amount', async () => {
    const tx = await buildProposeCall(mainnet, {
      to: MVXVEST,
      functionName: 'setFee',
      args: [{ kind: 'egld', value: '0.01' }]
    });
    expect(text(tx.data)).toBe(
      'proposeAsyncCall@00000000000000000500f882d8136db7846cdb650b16134bb5424da58ddfe614@@736574466565@2386f26fc10000'
    );
    expect(tx.receiver.toBech32()).toBe(SAFE);
  });

  test('the same fee typed as a whole number of base units is the same bytes', async () => {
    const tx = await buildProposeCall(mainnet, {
      to: MVXVEST,
      functionName: 'setFee',
      args: [{ kind: 'number', value: '10000000000000000' }]
    });
    expect(text(tx.data)).toBe(
      'proposeAsyncCall@00000000000000000500f882d8136db7846cdb650b16134bb5424da58ddfe614@@736574466565@2386f26fc10000'
    );
  });

  // mvxvest's own devnet proof, d753689bcbf90e0eea8e4654d1159029401512512b43465b01f6cc631a37d024,
  // sent at nonce 78 to its 2-of-2 devnet safe against this multisig's exact bytecode.
  test('the upgrade rebuilds the devnet transaction d753689b exactly', async () => {
    const tx = await buildProposeUpgrade(
      {
        chainId: 'D',
        sender:
          'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl',
        nonce: 78,
        safe: 'erd1qqqqqqqqqqqqqpgqyhjacmc59pem8ywgu9e5met6l49mst7lerksrtaq6e'
      },
      {
        target: fromHex(
          '00000000000000000500eda3c303c22c4cf1a240a66be3331bcf3bce588b4eb0'
        ),
        source: fromHex(
          '00000000000000000500c5f72f041044a0f58d39cf191a74f0dedcc56056c8ed'
        ),
        metadata: '0500'
      }
    );
    expect(text(tx.data)).toBe(
      'proposeSCUpgradeFromSource@00000000000000000500eda3c303c22c4cf1a240a66be3331bcf3bce588b4eb0@@00000000000000000500c5f72f041044a0f58d39cf191a74f0dedcc56056c8ed@0500'
    );
    expect(tx.nonce).toBe(78n);
    expect(tx.receiver.toBech32()).toBe(
      'erd1qqqqqqqqqqqqqpgqyhjacmc59pem8ywgu9e5met6l49mst7lerksrtaq6e'
    );
  });

  test('on mainnet: mvxvest, nothing sent, a source in shard 1, metadata 0500, no arguments', async () => {
    const tx = await buildProposeUpgrade(mainnet, {
      target: MVXVEST,
      source: SHARD1_SOURCE,
      metadata: '0500'
    });
    const sourceHex = Address.newFromBech32(SHARD1_SOURCE).toHex();
    expect(text(tx.data)).toBe(
      `proposeSCUpgradeFromSource@00000000000000000500f882d8136db7846cdb650b16134bb5424da58ddfe614@@${sourceHex}@0500`
    );
  });

  test('metadata as flags gives the same bytes as its hex', async () => {
    const a = await buildProposeUpgrade(mainnet, {
      target: MVXVEST,
      source: SHARD1_SOURCE,
      metadata: '0500'
    });
    const b = await buildProposeUpgrade(mainnet, {
      target: MVXVEST,
      source: SHARD1_SOURCE,
      metadata: {
        upgradeable: true,
        readable: true,
        payable: false,
        payableBySc: false
      }
    });
    expect(text(b.data)).toBe(text(a.data));
  });
});

describe('an upgrade that would fail after its signatures is refused before', () => {
  test('a source in another shard than the safe', async () => {
    // mvxvest itself lives in shard 0; the safe in shard 1.
    expect(shardOf(MVXVEST)).toBe(0);
    expect(shardOf(SAFE)).toBe(1);
    await expect(
      buildProposeUpgrade(mainnet, {
        target: MVXVEST,
        source: MVXVEST,
        metadata: '0500'
      })
    ).rejects.toThrow(
      /source is in shard 0 and the safe in shard 1.*use the action up/
    );
  });

  test('metadata without "upgradeable", as hex', async () => {
    await expect(
      buildProposeUpgrade(mainnet, {
        target: MVXVEST,
        source: SHARD1_SOURCE,
        metadata: '0400'
      })
    ).rejects.toThrow(/never be changed again/);
  });

  test('metadata without "upgradeable", as flags, whatever the others say', async () => {
    for (const hex of ['0000', '0400', '0402', '0406']) {
      await expect(
        buildProposeUpgrade(mainnet, {
          target: MVXVEST,
          source: SHARD1_SOURCE,
          metadata: metadataFromHex(hex)
        })
      ).rejects.toThrow(/never be changed again/);
    }
  });

  test('the safe itself, or an address that is not a contract', async () => {
    expect(
      upgradeProblem({
        safe: SAFE,
        target: SAFE,
        source: SHARD1_SOURCE,
        metadata: '0500'
      })
    ).toMatch(/safe itself/);
    expect(
      upgradeProblem({
        safe: SAFE,
        target: BOARD_MEMBER,
        source: SHARD1_SOURCE,
        metadata: '0500'
      })
    ).toMatch(/contract address/);
    expect(
      upgradeProblem({
        safe: SAFE,
        target: MVXVEST,
        source: BOARD_MEMBER,
        metadata: '0500'
      })
    ).toMatch(/source has to be a contract/);
  });

  test("control: the same upgrade with a source in the safe's shard is accepted", () => {
    expect(
      upgradeProblem({
        safe: SAFE,
        target: MVXVEST,
        source: SHARD1_SOURCE,
        metadata: '0500'
      })
    ).toBe('');
  });
});

describe('code metadata and code hashes', () => {
  test('0500 is upgradeable and readable, nothing else', () => {
    expect(metadataFromHex('0500')).toEqual({
      upgradeable: true,
      readable: true,
      payable: false,
      payableBySc: false
    });
    expect(metadataFromHex('0506')).toEqual({
      upgradeable: true,
      readable: true,
      payable: true,
      payableBySc: true
    });
  });

  test('every combination of flags survives hex and back', () => {
    for (let bits = 0; bits < 16; bits++) {
      const flags = {
        upgradeable: Boolean(bits & 1),
        readable: Boolean(bits & 2),
        payable: Boolean(bits & 4),
        payableBySc: Boolean(bits & 8)
      };
      expect(metadataFromHex(metadataToHex(flags))).toEqual(flags);
    }
  });

  test('anything but two bytes is not metadata', () => {
    expect(() => metadataFromHex('05')).toThrow();
    expect(() => metadataFromHex('zz00')).toThrow();
  });

  test('blake2b-256 of the shipped multisig is the code hash the chain reports for every safe', () => {
    const wasm = new Uint8Array(
      readFileSync(join(__dirname, '../../../public/contracts/multisig.wasm'))
    );
    expect(codeHashOf(wasm)).toBe(
      'f5658529c51ccc2985e8b2977374c909417ed07efb92b1deaf800137f5c25861'
    );
    expect(normalizeCodeHash(MULTISIG_CODE_HASH)).toBe(codeHashOf(wasm));
  });

  test('a code hash is read from hex in any case, with or without 0x, or from base64', () => {
    const hex =
      'fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32';
    expect(normalizeCodeHash(hex.toUpperCase())).toBe(hex);
    expect(normalizeCodeHash(`0x${hex}`)).toBe(hex);
    expect(
      normalizeCodeHash('/TL04WFlP+L1xbZz3I8nhtcYoh9OwltmPDZa/PWmfTI=')
    ).toBe(hex);
    expect(normalizeCodeHash(hex.slice(1))).toBeNull();
    expect(normalizeCodeHash('')).toBeNull();
  });
});

describe('arguments, written as the target reads them', () => {
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

  test('each kind', () => {
    expect(hex(encodeArgument('egld', '0.01'))).toBe('2386f26fc10000');
    expect(hex(encodeArgument('number', '0'))).toBe('');
    expect(hex(encodeArgument('number', '1'))).toBe('01');
    expect(hex(encodeArgument('number', '256'))).toBe('0100');
    expect(hex(encodeArgument('bool', 'true'))).toBe('01');
    expect(hex(encodeArgument('bool', 'false'))).toBe('');
    expect(hex(encodeArgument('hex', '0x0aFF'))).toBe('0aff');
    expect(hex(encodeArgument('text', 'FOXSY-5d5f3e'))).toBe(
      Buffer.from('FOXSY-5d5f3e').toString('hex')
    );
    expect(hex(encodeArgument('address', SAFE))).toBe(
      '00000000000000000500cfa5b23936bfab8eecfc04d7ed2b14a8b8040743d03f'
    );
  });

  test('what cannot be written exactly is refused', () => {
    expect(() => encodeArgument('number', '1,5')).toThrow();
    expect(() => encodeArgument('number', '-1')).toThrow();
    expect(() => encodeArgument('number', '1e18')).toThrow();
    expect(() => encodeArgument('egld', '0.0000000000000000001')).toThrow(
      /18 decimals/
    );
    expect(() => encodeArgument('hex', '0x123')).toThrow();
    expect(() => encodeArgument('bool', 'maybe')).toThrow();
    expect(() =>
      encodeArgument(
        'address',
        'c4cee2dd484da1a4a3f7363696ed1c53dc9baf41ee38ca4ab3000b025e2d6963'
      )
    ).toThrow();
  });

  test('a call needs a function name a contract can have', async () => {
    await expect(
      buildProposeCall(mainnet, { to: MVXVEST, functionName: '' })
    ).rejects.toThrow(/Name the function/);
    await expect(
      buildProposeCall(mainnet, { to: MVXVEST, functionName: 'set fee' })
    ).rejects.toThrow();
    await expect(
      buildProposeCall(mainnet, { to: MVXVEST, functionName: '@setFee' })
    ).rejects.toThrow();
  });

  test('a call without arguments is the function name alone', async () => {
    const tx = await buildProposeCall(mainnet, {
      to: MVXVEST,
      functionName: 'pauseCreation'
    });
    expect(text(tx.data)).toBe(
      `proposeAsyncCall@00000000000000000500f882d8136db7846cdb650b16134bb5424da58ddfe614@@${Buffer.from('pauseCreation').toString('hex')}`
    );
  });
});

describe('deploying a source', () => {
  test('not upgradeable, readable, not payable, no arguments', async () => {
    const wasm = new Uint8Array(
      readFileSync(join(__dirname, '../../../public/contracts/multisig.wasm'))
    );
    const tx = await buildDeploySource(
      { chainId: 'D', sender: BOARD_MEMBER, nonce: 7 },
      { bytecode: wasm }
    );
    const parts = text(tx.data).split('@');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(Buffer.from(wasm).toString('hex'));
    expect(parts.slice(1)).toEqual(['0500', '0400']); // the wasm VM, then not upgradeable + readable
    expect(tx.receiver.toBech32()).toBe(
      'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu'
    );
  });
});

describe('gas: never more than about 1.5 times what is needed', () => {
  test("a simulation plus a fifth, rounded up: mvxvest's own proposal of 5,174,371 got 6,209,246", () => {
    expect(withMargin(5174371n)).toBe(6209246n);
  });

  test('builders leave the limit to settleGas, so no flat 60M is ever sent', async () => {
    const sign = await buildSign(mainnet, 3);
    const call = await buildProposeCall(mainnet, {
      to: MVXVEST,
      functionName: 'pauseCreation'
    });
    expect(sign.gasLimit).toBe(0n);
    expect(call.gasLimit).toBe(0n);
  });

  test("upgrading to mvxvest's 26,540 bytes: 7.5M + 1.2 x 9M + 7M, about 1.2 times the 20.5M floor", () => {
    // Measured on devnet: 8,264,045 used in the target's shard, the code's
    // size not charged as data (b91b6190..., 778cc307..., f2fc033b...).
    expect(upgradeNeed(26540)).toBe(8962000n);
    const plan = performPlan({ name: 'SCUpgradeFromSource', codeBytes: 26540 });
    expect(plan.simulate).toBe(false);
    if (plan.simulate) return;
    expect(plan.gasLimit).toBe(25300000n);
    expect(plan.parts).toEqual({
      safe: SAFE_OWN_GAS,
      call: 10754400n,
      callback: CALLBACK_GAS
    });
    // The measured need, with the margin, fits in what the call is given.
    expect(withMargin(8264045n)).toBeLessThanOrEqual(plan.parts.call);
  });

  test("a call: what it needed as the safe plus a fifth, between the safe's part and the callback", () => {
    const plan = performPlan({ name: 'SendAsyncCall', callNeed: 3800000n });
    if (plan.simulate) throw new Error('should be a budget');
    expect(plan.gasLimit).toBe(19100000n); // setFee worked with 17.3M; its floor is about 16.4M
    expect(plan.known).toBe(true);
  });

  test('a call that could not be tried gets a default the page calls one', () => {
    const plan = performPlan({ name: 'SendAsyncCall', callNeed: null });
    if (plan.simulate) throw new Error('should be a budget');
    expect(plan.need).toBe(UNKNOWN_CALL_NEED);
    expect(plan.known).toBe(false);
    expect(plan.gasLimit).toBe(26500000n);
  });

  test('membership, quorum and deploys stay inside the safe and are simulated', () => {
    for (const name of [
      'AddBoardMember',
      'AddProposer',
      'RemoveUser',
      'ChangeQuorum',
      'SCDeployFromSource'
    ]) {
      expect(performPlan({ name })).toEqual({ simulate: true });
    }
  });

  test('a plain EGLD transfer cannot be simulated either: 7.5M + a fifth over the minimum, no callback', () => {
    // devnet answers "nil vm output"; with 12.6M it used about 5.6M in the safe (f0fcdb3b...).
    const plan = performPlan({
      name: 'SendTransferExecute',
      hasFunction: false
    });
    if (plan.simulate) throw new Error('should be a budget');
    expect(plan.gasLimit).toBe(7600000n);
    expect(plan.parts.callback).toBe(0n);
    expect(plan.known).toBe(true);
  });

  test('a transfer that calls a function gets its need from the trial, and no callback', () => {
    const plan = performPlan({
      name: 'SendTransferExecute',
      hasFunction: true,
      callNeed: 3800000n
    });
    if (plan.simulate) throw new Error('should be a budget');
    expect(plan.gasLimit).toBe(12100000n);
  });

  const GUARDIAN =
    'erd13n5qd94ukuu2s2e3dppavdp0v7q89hj0nk9x2tulhlqyu6hcxy9s3xw87f';

  test('the guardian goes on BEFORE the simulation, and its 50,000 after', async () => {
    const seen: Transaction[] = [];
    const provider = {
      estimateTransactionCost: async (tx: Transaction) => {
        seen.push(Transaction.newFromPlainObject(tx.toPlainObject()));
        return { gasLimit: 5000000 };
      }
    };
    const tx = await buildSign(mainnet, 3);
    await settleGas(tx, { provider, guardian: GUARDIAN });
    expect(seen).toHaveLength(1);
    expect(seen[0].guardian.toBech32()).toBe(GUARDIAN);
    expect(seen[0].version).toBe(2);
    expect(seen[0].options & 2).toBe(2);
    expect(tx.gasLimit).toBe(6000000n + GUARDIAN_GAS);
  });

  test('unguarded: the simulation plus a fifth, nothing more', async () => {
    const tx = await buildSign(mainnet, 3);
    await settleGas(tx, {
      provider: { estimateTransactionCost: async () => ({ gasLimit: 4310000 }) }
    });
    expect(tx.gasLimit).toBe(5172000n);
  });

  test("a budget is not simulated, and still gets the guardian's part", async () => {
    const estimate = jest.fn();
    const tx = await buildSign(mainnet, 3);
    await settleGas(tx, {
      provider: { estimateTransactionCost: estimate },
      guardian: GUARDIAN,
      budget: 23300000n
    });
    expect(estimate).not.toHaveBeenCalled();
    expect(tx.gasLimit).toBe(23350000n);
    expect(tx.guardian.toBech32()).toBe(GUARDIAN);
  });

  test('a refusal by the network stops the send and says why', async () => {
    const { ErrEstimateTransactionCost } = jest.requireActual(
      '@multiversx/sdk-core'
    );
    const tx = await buildSign(mainnet, 3);
    const attempt = settleGas(tx, {
      provider: {
        estimateTransactionCost: async () => {
          throw new ErrEstimateTransactionCost(
            'not allowed to bypass guardian'
          );
        }
      }
    });
    await expect(attempt).rejects.toThrow(
      /refused it when trying it in advance: not allowed to bypass guardian/
    );
    await expect(attempt).rejects.toBeInstanceOf(GasError);
  });

  test('a network that does not answer stops the send too, saying so', async () => {
    const tx = await buildSign(mainnet, 3);
    const attempt = settleGas(tx, {
      provider: {
        estimateTransactionCost: async () => {
          throw new Error(
            'Request error on url [transaction/cost]: [socket hang up]'
          );
        }
      }
    });
    await expect(attempt).rejects.toThrow(/could not try it in advance/);
  });

  test('never above what one transaction may use', async () => {
    const tx = await buildSign(mainnet, 3);
    await expect(
      settleGas(tx, {
        provider: { estimateTransactionCost: async () => ({ gasLimit: 0 }) },
        budget: 600000001n
      })
    ).rejects.toThrow(/600,000,000/);
  });

  test('the fee of an upgrade perform is about three ten-thousandths of an EGLD', () => {
    // performAction@05 is 16 bytes of data; the rest of the limit is priced at a hundredth.
    const fee = feeOf(23300000n, 16);
    expect(fee).toBe(74000n * 1000000000n + (23300000n - 74000n) * 10000000n);
    expect(Number(fee) / 1e18).toBeCloseTo(0.000306, 5);
  });
});

describe('what a call leaving the safe needs', () => {
  const call = { chainId: 'D', safe: SAFE, to: BOARD_MEMBER, data: '' };
  const answering = (gasLimit: number) => ({
    estimateTransactionCost: async () => ({ gasLimit })
  });

  test('a plain token transfer has a fixed cost: the minimum, its data and the built-in 200,000', () => {
    const data = `ESDTTransfer@${Buffer.from('WEGLD-a28c59').toString('hex')}@06f05b59d3b20000`;
    // 331,001 when devnet could measure it, to a wallet in the safe's own shard.
    expect(tokenTransferNeed(data)).toBe(
      50000n + 1500n * BigInt(data.length) + 200000n
    );
    expect(
      tokenTransferNeed(`${data}@${Buffer.from('deposit').toString('hex')}`)
    ).toBeNull();
    expect(tokenTransferNeed('setFee@2386f26fc10000')).toBeNull();
  });

  test('a trial answering 600,000,000 measured nothing: a token transfer then gets its fixed cost', async () => {
    const data = `ESDTTransfer@${Buffer.from('WEGLD-a28c59').toString('hex')}@06f05b59d3b20000`;
    expect(await measureCall(answering(600000000), { ...call, data })).toEqual({
      need: tokenTransferNeed(data),
      how: 'token'
    });
  });

  test('...and anything else no figure at all, never 600,000,000 taken as one', async () => {
    expect(
      await measureCall(answering(600000000), {
        ...call,
        data: 'setFee@2386f26fc10000'
      })
    ).toEqual({ need: null, how: 'unmeasured' });
  });

  test('a real figure is the need', async () => {
    expect(
      await measureCall(answering(3925235), {
        ...call,
        data: 'setFee@2386f26fc10000'
      })
    ).toEqual({ need: 3925235n, how: 'tried' });
  });

  test('a call the contract refuses throws, so nothing goes on', async () => {
    const { ErrEstimateTransactionCost } = jest.requireActual(
      '@multiversx/sdk-core'
    );
    const refusing = {
      estimateTransactionCost: async () => {
        throw new ErrEstimateTransactionCost(
          'user error: Endpoint can only be called by owner'
        );
      }
    };
    await expect(
      measureCall(refusing, { ...call, data: 'setFee@01' })
    ).rejects.toThrow(/only be called by owner/);
  });
});

describe('what the page says when the gas could not be settled', () => {
  const { explainWalletFailure } = jest.requireActual('multisig/walletFailure');
  beforeEach(() =>
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  );

  test('a network that timed out during the trial sent nothing, and the page says exactly that', () => {
    const failure = new GasError(
      'The network could not try it in advance (Request error: [timeout of 15000ms exceeded]), so nothing was sent. Try again in a moment.',
      false
    );
    const said = explainWalletFailure(failure, 'The proposal');
    expect(said).toMatch(/nothing was sent/);
    expect(said).not.toMatch(/may still have gone through/);
  });

  test("a refusal is said in the network's words", () => {
    const failure = new GasError(
      'The network refused it when trying it in advance: user error: action does not exist. Nothing was sent.',
      true
    );
    expect(explainWalletFailure(failure, 'That')).toBe(failure.message);
  });
});

// mvxvest version 2 (branch upgrade-v2, 14 Oct 2026): the votes the board will be asked for.
describe('mvxvest version 2: the token fee and the new EGLD fee', () => {
  const { describeAction } = jest.requireActual('multisig/describe');
  const card = (endpoint: string, argument: Uint8Array) =>
    describeAction(
      {
        name: 'SendAsyncCall',
        fields: [
          {
            to: MVXVEST,
            egld_amount: 0n,
            endpoint_name: Buffer.from(endpoint),
            arguments: [argument]
          }
        ]
      },
      SAFE
    );

  test('setTokenFee 100 basis points is setTokenFee@64, byte for byte', async () => {
    const tx = await buildProposeCall(mainnet, {
      to: MVXVEST,
      functionName: 'setTokenFee',
      args: [{ kind: 'number', value: '100' }]
    });
    expect(text(tx.data)).toBe(
      `proposeAsyncCall@00000000000000000500f882d8136db7846cdb650b16134bb5424da58ddfe614@@${Buffer.from('setTokenFee').toString('hex')}@64`
    );
  });

  test('setFee 0.1 EGLD is setFee@016345785d8a0000', async () => {
    const tx = await buildProposeCall(mainnet, {
      to: MVXVEST,
      functionName: 'setFee',
      args: [{ kind: 'egld', value: '0.1' }]
    });
    expect(text(tx.data).endsWith('@736574466565@016345785d8a0000')).toBe(true);
  });

  test('the card reads 0x64 as 100, never as the letter it also is', async () => {
    expect(await card('setTokenFee', Uint8Array.of(0x64))).toBe(
      `Call setTokenFee(100 [or the text "d"]) on ${MVXVEST}`
    );
    expect(await card('setTokenFee', Uint8Array.of(0x32))).toBe(
      `Call setTokenFee(50) on ${MVXVEST}`
    );
  });

  test('and 0.1 EGLD as its exact number, read as EGLD', async () => {
    expect(
      await card(
        'setFee',
        Uint8Array.from(Buffer.from('016345785d8a0000', 'hex'))
      )
    ).toBe(
      `Call setFee(100,000,000,000,000,000 [0.1 EGLD at 18 decimals]) on ${MVXVEST}`
    );
  });

  test("upgrading to version 2's 27,389 bytes needs about 9.2M, a 25.6M perform", () => {
    expect(upgradeNeed(27389)).toBe(9216700n);
    const plan = performPlan({ name: 'SCUpgradeFromSource', codeBytes: 27389 });
    if (plan.simulate) throw new Error('should be a budget');
    expect(plan.gasLimit).toBe(25600000n);
  });
});

// mvxvest's upgrade to version 2 on mainnet, 14 Oct 2026 (c6ef96cf…): the
// upgrade used 8,501,645 where it ran and the callback 3,392,472, both exactly
// devnet's. Mainnet's first upgrades had kept 118.5M until this measurement.
describe('an upgrade on mainnet, measured', () => {
  test('gets the budget devnet measured: 25.6M for version 2, 1.23 times its 20.8M floor', () => {
    const plan = performPlan({ name: 'SCUpgradeFromSource', codeBytes: 27332 });
    if (plan.simulate) throw new Error('should be a budget');
    expect(plan.gasLimit).toBe(25600000n);
    // What mainnet's upgrade used, with the margin, fits in what the call is given.
    expect(withMargin(8501645n)).toBeLessThanOrEqual(plan.parts.call);
    // The safe's part (5.82M), the lock (6.46M) and the upgrade (8.50M) fit too.
    expect(5820000n + 6458200n + 8501645n).toBeLessThan(plan.gasLimit);
  });
});

// The planned mainnet vote, set to 0.1% on 14 Oct 2026: one byte 0x0a, which
// is also a newline, so a text reading would show nothing at all.
describe('setTokenFee 10 basis points, the vote planned for mainnet', () => {
  const { describeAction } = jest.requireActual('multisig/describe');

  test('is setTokenFee@0a, byte for byte', async () => {
    const tx = await buildProposeCall(mainnet, {
      to: MVXVEST,
      functionName: 'setTokenFee',
      args: [{ kind: 'number', value: '10' }]
    });
    expect(text(tx.data)).toBe(
      'proposeAsyncCall@00000000000000000500f882d8136db7846cdb650b16134bb5424da58ddfe614@@736574546f6b656e466565@0a'
    );
  });

  test('and reads on the card as 10', async () => {
    const sentence = await describeAction(
      {
        name: 'SendAsyncCall',
        fields: [
          {
            to: MVXVEST,
            egld_amount: 0n,
            endpoint_name: Buffer.from('setTokenFee'),
            arguments: [Uint8Array.of(0x0a)]
          }
        ]
      },
      SAFE
    );
    expect(sentence).toBe(`Call setTokenFee(10) on ${MVXVEST}`);
  });
});
