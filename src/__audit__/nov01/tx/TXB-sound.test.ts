/**
 * @jest-environment node
 */
// Not a finding: the checks of the tx area that HELD on 1 Nov 2026, kept as
// regression guards. Every builder is taken apart again through the shipped
// ABI and compared with the exact bytecode's exports; the encoders are fuzzed
// against sdk-core's own codec; the chain id and the guardian come from where
// they should.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  Address,
  AddressValue,
  ArgSerializer,
  BigUIntValue,
  BinaryCodec,
  U32Value
} from '@multiversx/sdk-core';
import {
  buildDeploySafe,
  buildDiscard,
  buildHandOver,
  buildPerform,
  buildProposeAddBoardMember,
  buildProposeAddProposer,
  buildProposeCall,
  buildProposeChangeQuorum,
  buildProposeEgld,
  buildProposeRemoveUser,
  buildProposeToken,
  buildProposeUpgrade,
  buildSign,
  buildUnsign,
  codeHashOf,
  encodeArgument,
  legacyAbi,
  MULTISIG_CODE_HASH,
  normalizeCodeHash,
  topEncode,
  toRawAmount
} from 'multisig/legacyCalls';
import legacyAbiJson from '../../../abi/multisig-legacy.abi.json';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const BOB = 'erd1cus9zpgyg8ztpvr48j8w8lqack3u7gtlnxlum22cdl0k0vfwm3eq54npug';
const SAFE = 'erd1qqqqqqqqqqqqqpgqa36jq897x6drcq8arsumtw7tns8f98t3xezs2vdjvf'; // shard 1
const VEST = 'erd1qqqqqqqqqqqqqpgqntmhxqa29ar4juhlprjjxaq790ykcj3uaujq2l9dzg'; // shard 0
const SOURCE = 'erd1qqqqqqqqqqqqqpgqsy2ept5xx2cprx3htj0l5lwkk52hh9amxezsygtpgl'; // shard 1
const context = { chainId: 'D', sender: ALICE, nonce: 7, safe: SAFE };
const wasm = new Uint8Array(
  readFileSync(join(__dirname, '../../../../public/contracts/multisig.wasm'))
);
const codec = new BinaryCodec();
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const text = (data: Uint8Array) => Buffer.from(data).toString();

/** The data field taken apart and decoded through the ABI's own input types. */
const decodeThroughAbi = (transaction: any) => {
  const [fn, ...parts] = text(transaction.data).split('@');
  const endpoint = legacyAbi.getEndpoint(fn);
  const values = new ArgSerializer().buffersToValues(
    parts.map((part) => Buffer.from(part, 'hex')),
    endpoint.input
  );
  return { fn, values };
};

describe('the ABI against the exact bytecode', () => {
  const exports = new Set(
    WebAssembly.Module.exports(new WebAssembly.Module(wasm))
      .filter((item) => item.kind === 'function')
      .map((item) => item.name)
  );

  test('the bytecode is the one the app ships and hashes to the code hash of every safe', () => {
    expect(codeHashOf(wasm)).toBe(normalizeCodeHash(MULTISIG_CODE_HASH));
  });

  test('every endpoint the app can build or query exists in the bytecode', () => {
    for (const endpoint of (legacyAbiJson as any).endpoints) {
      expect(exports.has(endpoint.name)).toBe(true);
    }
  });

  test('the bytecode exports exactly the endpoints the brief names, and nothing the app overlooks is callable by the app', () => {
    const named = [
      'init',
      'deposit',
      'sign',
      'unsign',
      'performAction',
      'discardAction',
      'proposeAddBoardMember',
      'proposeAddProposer',
      'proposeRemoveUser',
      'proposeChangeQuorum',
      'proposeTransferExecute',
      'proposeAsyncCall',
      'proposeSCDeployFromSource',
      'proposeSCUpgradeFromSource',
      'dnsRegister',
      'callBack',
      'getQuorum',
      'getNumBoardMembers',
      'getNumProposers',
      'getActionLastIndex',
      'getAllBoardMembers',
      'getAllProposers',
      'userRole',
      'quorumReached',
      'signed',
      'getActionData',
      'getActionSigners',
      'getActionSignerCount',
      'getActionValidSignerCount',
      'getPendingActionFullInfo'
    ];
    expect([...exports].sort()).toEqual([...named].sort());
  });
});

describe('every builder, taken apart through the ABI', () => {
  test('sign, unsign, performAction, discardAction carry the action id as a u32', async () => {
    for (const [build, fn] of [
      [buildSign, 'sign'],
      [buildUnsign, 'unsign'],
      [buildPerform, 'performAction'],
      [buildDiscard, 'discardAction']
    ] as const) {
      for (const id of [1, 127, 128, 255, 256, 65535, 65536, 4294967295]) {
        const transaction = await build(context, id);
        expect(transaction.receiver.toBech32()).toBe(SAFE);
        expect(transaction.value).toBe(0n);
        expect(transaction.chainID).toBe('D');
        expect(transaction.nonce).toBe(7n);
        expect(transaction.gasLimit).toBe(0n);
        const { fn: name, values } = decodeThroughAbi(transaction);
        expect(name).toBe(fn);
        expect(Number((values[0] as U32Value).valueOf())).toBe(id);
      }
    }
  });

  test('an EGLD transfer: proposeTransferExecute(to, amount) and no function', async () => {
    const transaction = await buildProposeEgld(context, {
      to: BOB,
      amount: '1.5'
    });
    const { fn, values } = decodeThroughAbi(transaction);
    expect(fn).toBe('proposeTransferExecute');
    expect((values[0] as AddressValue).valueOf().toBech32()).toBe(BOB);
    expect((values[1] as BigUIntValue).valueOf().toFixed()).toBe(
      '1500000000000000000'
    );
    expect((values[2] as any).getItems()).toHaveLength(0);
  });

  test('a token transfer: proposeAsyncCall(to, 0, ESDTTransfer, token, amount), the amount top-encoded', async () => {
    const transaction = await buildProposeToken(context, {
      to: BOB,
      tokenIdentifier: 'TOKEN-abc123',
      amount: '250000',
      decimals: 18
    });
    const { fn, values } = decodeThroughAbi(transaction);
    expect(fn).toBe('proposeAsyncCall');
    expect((values[0] as AddressValue).valueOf().toBech32()).toBe(BOB);
    expect((values[1] as BigUIntValue).valueOf().toFixed()).toBe('0');
    const items = (values[2] as any)
      .getItems()
      .map((item: any) => Buffer.from(item.valueOf()));
    expect(items.map((item: Buffer) => item.toString())).toEqual([
      'ESDTTransfer',
      'TOKEN-abc123',
      expect.any(String)
    ]);
    expect(items[2].toString('hex')).toBe(
      hex(codec.encodeTopLevel(new BigUIntValue(250000n * 10n ** 18n)))
    );
  });

  test('membership and quorum', async () => {
    for (const [build, fn] of [
      [buildProposeAddBoardMember, 'proposeAddBoardMember'],
      [buildProposeAddProposer, 'proposeAddProposer'],
      [buildProposeRemoveUser, 'proposeRemoveUser']
    ] as const) {
      const { fn: name, values } = decodeThroughAbi(await build(context, BOB));
      expect(name).toBe(fn);
      expect((values[0] as AddressValue).valueOf().toBech32()).toBe(BOB);
    }
    const quorum = decodeThroughAbi(await buildProposeChangeQuorum(context, 2));
    expect(quorum.fn).toBe('proposeChangeQuorum');
    expect(Number((quorum.values[0] as U32Value).valueOf())).toBe(2);
  });

  test('a call: proposeAsyncCall(to, egld, name, args...), every argument as given', async () => {
    const transaction = await buildProposeCall(context, {
      to: VEST,
      egld: '0.01',
      functionName: 'setFee',
      args: [
        { kind: 'egld', value: '0.02' },
        { kind: 'number', value: '10' },
        { kind: 'address', value: BOB },
        { kind: 'text', value: 'TOKEN-abc123' },
        { kind: 'hex', value: '0x0102' },
        { kind: 'bool', value: 'true' },
        { kind: 'bool', value: 'false' },
        { kind: 'number', value: '0' }
      ]
    });
    const { fn, values } = decodeThroughAbi(transaction);
    expect(fn).toBe('proposeAsyncCall');
    expect((values[0] as AddressValue).valueOf().toBech32()).toBe(VEST);
    expect((values[1] as BigUIntValue).valueOf().toFixed()).toBe(
      '10000000000000000'
    );
    const items = (values[2] as any)
      .getItems()
      .map((item: any) => Buffer.from(item.valueOf()).toString('hex'));
    expect(items).toEqual([
      Buffer.from('setFee').toString('hex'),
      '470de4df820000',
      '0a',
      hex(Address.newFromBech32(BOB).getPublicKey()),
      Buffer.from('TOKEN-abc123').toString('hex'),
      '0102',
      '01',
      '',
      ''
    ]);
    // The same bytes as the wire: nothing is lost in the empty arguments.
    expect(text(transaction.data).endsWith('@01@@')).toBe(true);
  });

  test('an upgrade: proposeSCUpgradeFromSource(contract, amount, source, metadata, args)', async () => {
    const transaction = await buildProposeUpgrade(context, {
      target: VEST,
      source: SOURCE,
      metadata: '0500'
    });
    const { fn, values } = decodeThroughAbi(transaction);
    expect(fn).toBe('proposeSCUpgradeFromSource');
    expect((values[0] as AddressValue).valueOf().toBech32()).toBe(VEST);
    expect((values[1] as BigUIntValue).valueOf().toFixed()).toBe('0');
    expect((values[2] as AddressValue).valueOf().toBech32()).toBe(SOURCE);
    expect(text(transaction.data)).toBe(
      `proposeSCUpgradeFromSource@${hex(Address.newFromBech32(VEST).getPublicKey())}@@${hex(Address.newFromBech32(SOURCE).getPublicKey())}@0500`
    );
  });

  test('the safe deploy and the handover', async () => {
    const deploy = await buildDeploySafe(
      { chainId: 'D', sender: ALICE, nonce: 7 },
      { bytecode: wasm, quorum: 2, board: [ALICE, BOB] }
    );
    const [code, vm, metadata, quorum, ...board] = text(deploy.data).split('@');
    expect(code).toBe(hex(wasm));
    expect(vm).toBe('0500');
    expect(metadata).toBe('0506');
    expect(quorum).toBe('02');
    expect(board).toEqual(
      [ALICE, BOB].map((member) =>
        hex(Address.newFromBech32(member).getPublicKey())
      )
    );
    expect(deploy.receiver.toBech32()).toBe(
      'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu'
    );
    const handOver = await buildHandOver({
      chainId: 'D',
      sender: ALICE,
      nonce: 8,
      safe: SAFE
    });
    expect(text(handOver.data)).toBe(
      `ChangeOwnerAddress@${hex(Address.newFromBech32(SAFE).getPublicKey())}`
    );
    expect(handOver.receiver.toBech32()).toBe(SAFE);
  });
});

describe('the encoders against sdk-core, fuzzed', () => {
  let seed = 20261101;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  const randomBig = () => {
    const bits = random() % 260;
    let value = 0n;
    for (let at = 0; at < bits; at += 15)
      value = (value << 15n) | BigInt(random() & 0x7fff);
    return value & ((1n << BigInt(bits)) - 1n);
  };

  test('topEncode and the number and egld arguments match the codec for 3,000 values', () => {
    for (let at = 0; at < 3000; at++) {
      const value = at < 300 ? BigInt(at) : randomBig();
      const expected = hex(codec.encodeTopLevel(new BigUIntValue(value)));
      expect(hex(topEncode(value))).toBe(expected);
      expect(hex(encodeArgument('number', value.toString()))).toBe(expected);
      // The same amount written with 18 decimals.
      const whole = (value / 10n ** 18n).toString();
      const fraction = (value % 10n ** 18n).toString().padStart(18, '0');
      expect(hex(encodeArgument('egld', `${whole}.${fraction}`))).toBe(
        expected
      );
    }
  });

  test('toRawAmount is exact for 2,000 random decimal strings at 0 to 18 decimals', () => {
    for (let at = 0; at < 2000; at++) {
      const decimals = random() % 19;
      const whole = randomBig() % 10n ** 12n;
      const fractionDigits = random() % (decimals + 1);
      const fraction = Array.from({ length: fractionDigits }, () =>
        String(random() % 10)
      ).join('');
      const written = fractionDigits ? `${whole}.${fraction}` : `${whole}`;
      const expected =
        whole * 10n ** BigInt(decimals) +
        (fractionDigits
          ? BigInt(fraction) * 10n ** BigInt(decimals - fractionDigits)
          : 0n);
      expect(toRawAmount(written, decimals)).toBe(expected);
    }
  });

  test.each([
    ['250,000', 18],
    ['1,000.00', 18],
    ['-1', 18],
    ['0x10', 18],
    ['1e3', 18],
    ['1.5', 0],
    ['0.0000000000000000001', 18],
    ['', 18],
    ['.', 18],
    [' ', 18],
    ['１', 18],
    ['1​', 18]
  ])('%s with %d decimals is refused', (written, decimals) => {
    expect(() => toRawAmount(written, decimals)).toThrow();
  });

  test('a token amount of zero or less is refused by the builder', async () => {
    for (const amount of ['0', '0.0', '-1', '']) {
      await expect(
        buildProposeToken(context, {
          to: BOB,
          tokenIdentifier: 'TOKEN-abc123',
          amount,
          decimals: 18
        })
      ).rejects.toThrow();
    }
  });
});
