/**
 * @jest-environment node
 *
 * The export parser reads what the API returned, so anything cut off, swollen
 * or repeated is not well-formed, never a guess; and what is not a function
 * export does not count. The real multisig has no upgrade function; a mock
 * source of any size does.
 */
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectUpgrade, readAccountFacts } from 'multisig/inspect';
import { predictSafeAddress } from 'multisig/legacyCalls';
import { wasmFunctionExports } from 'multisig/wasmExports';
import {
  contract,
  mockAccounts,
  mockCode
} from '../../../multisig/tests/contractsMock';
import { ALICE, CAROL, SAFE } from '../../display/fixtures';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const HEAD = '0061736d01000000';
const EXPORTS = '071202' + '04696e69740000' + '0775706772616465' + '0001';

test('the real multisig: its endpoints, and no upgrade', () => {
  const names = wasmFunctionExports(
    new Uint8Array(
      readFileSync(
        join(__dirname, '../../../../public/contracts/multisig.wasm')
      )
    )
  );
  expect(names).toContain('performAction');
  expect(names).toContain('dnsRegister');
  expect(names).not.toContain('upgrade');
});

test('a module with an upgrade function', () => {
  expect(wasmFunctionExports(bytes(HEAD + EXPORTS))).toEqual([
    'init',
    'upgrade'
  ]);
});

test('sections around it, custom ones included, are stepped over', () => {
  expect(
    wasmFunctionExports(bytes(HEAD + '000300ffff' + '01010' + '0' + EXPORTS))
  ).toEqual(['init', 'upgrade']);
});

test('no export section is no exports, not malformed', () => {
  expect(wasmFunctionExports(bytes(HEAD))).toEqual([]);
});

test('an upgrade that is not a function does not count', () => {
  // The same name exported as a global, kind 3.
  expect(
    wasmFunctionExports(bytes(HEAD + '070b01' + '0775706772616465' + '0300'))
  ).toEqual([]);
});

test.each([
  ['nothing', ''],
  ['not wasm', 'abababababababab'],
  ['another version', '0061736d02000000'],
  ['cut inside the header', '0061736d'],
  ['a section longer than the file', HEAD + '07ff01'],
  ['a section size that never ends', HEAD + '07ffffffffffff'],
  ['a size over 32 bits', HEAD + '07ffffffffff00'],
  ['more exports than bytes', HEAD + '0703ff0100'],
  ['a name longer than its section', HEAD + '0705017f696e69'],
  ['a name with no kind', HEAD + '070601' + '04696e6974'],
  ['an index past the section', HEAD + '070701' + '04696e697400'],
  ['bytes left over in the section', HEAD + '071302' + EXPORTS.slice(6) + '00'],
  ['two export sections', HEAD + EXPORTS + EXPORTS],
  ['the last section cut off', HEAD + EXPORTS.slice(0, -2)]
])('malformed: %s', (_what, hex) => {
  expect(wasmFunctionExports(bytes(hex))).toBeNull();
});

test('every cut of a real module answers without a throw, and never with invented names', () => {
  const whole = bytes(HEAD + EXPORTS);
  for (let end = 0; end < whole.length; end++) {
    const names = wasmFunctionExports(whole.subarray(0, end));
    if (names !== null) expect(names).toEqual([]);
  }
});

describe('on the card', () => {
  const TARGET = predictSafeAddress(CAROL, 40);
  const SOURCE = predictSafeAddress(ALICE, 60);
  const fields = [TARGET, 0n, SOURCE, Uint8Array.of(0x05, 0x00), []];
  beforeEach(() => {
    mockAccounts[TARGET] = contract({ owner: SAFE, hash: mockCode('old') });
  });

  test('control: the mock source has an upgrade function, of the size asked', async () => {
    mockAccounts[SOURCE] = contract({
      owner: ALICE,
      upgradeable: false,
      hash: mockCode('new', 1000)
    });
    const facts = await readAccountFacts(SOURCE);
    expect(facts.exportsUpgrade).toBe(true);
    expect(facts.codeBytes).toBe(1000);
    const { upgrade } = await inspectUpgrade(fields, SAFE);
    expect(upgrade?.sourceUnread).toBe(false);
  });

  test('malformed code counts as unread: held, and no hash to compare', async () => {
    const hash = mockCode('new');
    mockAccounts[SOURCE] = {
      ...contract({ owner: ALICE, upgradeable: false, hash }),
      code: 'abab',
      // The API's hash of those very bytes: only the wasm is wrong.
      codeHash: Buffer.from(
        (await import('@noble/hashes/blake2b')).blake2b(bytes('abab'), {
          dkLen: 32
        })
      ).toString('base64')
    };
    const { checks, upgrade } = await inspectUpgrade(fields, SAFE);
    expect(upgrade?.sourceUnread).toBe(true);
    expect(upgrade?.sourceHash).toBeNull();
    expect(
      checks.some(
        (check) => check.tone === 'bad' && /well-formed wasm/.test(check.text)
      )
    ).toBe(true);
  });

  test('the same code as today: the line is about that code, and only when it has the function', async () => {
    const hash = mockCode('same');
    mockAccounts[SOURCE] = contract({ owner: ALICE, upgradeable: false, hash });
    mockAccounts[TARGET] = contract({ owner: SAFE, hash });
    const { checks } = await inspectUpgrade(fields, SAFE);
    expect(
      checks.some((check) =>
        /only runs that code's upgrade function/.test(check.text)
      )
    ).toBe(true);
  });
});
