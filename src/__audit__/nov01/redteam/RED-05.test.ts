// RED-05 (redteam audit, 1 Nov 2026): an import file can put a second safe
// under a name already in use. The list then shows two "Treasury" cards that
// differ only in their shortened address, and the copy button on either
// copies that card's address. A file "with our safes and names", sent to a
// board member or a contributor, is how a stranger's safe gets a trusted name
// in someone's list, and then the tokens meant for that safe.
// Addresses already in the list are skipped on import; names are not looked
// at. (BRW-06 made a name safe to show; it did not make it unique.)
import { Address } from '@multiversx/sdk-core';
import {
  addSafe,
  getAllSafes,
  importSafes,
  nameInUse
} from 'multisig/savedSafes';

const TREASURY =
  'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
// Another contract address, a valid one, never used by anyone here.
const STRANGER = new Address(
  Uint8Array.from([
    ...new Array(8).fill(0),
    ...new Array(2).fill(0),
    ...Array.from({ length: 22 }, (_, at) => (at * 37 + 11) % 256)
  ])
).toBech32();

const ANOTHER = new Address(
  Uint8Array.from([
    ...new Array(10).fill(0),
    ...Array.from({ length: 22 }, (_, at) => (at * 53 + 7) % 256)
  ])
).toBech32();

beforeEach(() => {
  window.localStorage.clear();
  addSafe({ name: 'Treasury', address: TREASURY });
});

test('control: a file with a new name and a new address adds one safe', () => {
  const result = importSafes(
    JSON.stringify({
      app: 'mvxsafe',
      safes: [{ name: 'Grants', address: STRANGER }]
    })
  );
  expect(result.added).toBe(1);
  expect(getAllSafes().map((safe) => safe.name)).toEqual([
    'Treasury',
    'Grants'
  ]);
});

test('a file naming a stranger\'s safe "Treasury" does not produce two safes called Treasury', () => {
  importSafes(
    JSON.stringify({
      app: 'mvxsafe',
      safes: [{ name: 'Treasury', address: STRANGER }]
    })
  );
  const names = getAllSafes().map((safe) => safe.name);
  // Skipped, or shown under a name that tells it apart: never the same name twice.
  expect(names.filter((name) => name === 'Treasury')).toHaveLength(1);
  expect(names).toEqual(['Treasury', 'Treasury (imported)']);
});

test('the name is told apart whatever its capitals, spaces or invisible characters', () => {
  importSafes(
    JSON.stringify({
      app: 'mvxsafe',
      safes: [{ name: ' treasury\u200b', address: STRANGER }]
    })
  );
  expect(getAllSafes().map((safe) => safe.name)).toEqual([
    'Treasury',
    'treasury (imported)'
  ]);
});

test('two entries of one file under one name stay apart, and the result says so', () => {
  const { renamed } = importSafes(
    JSON.stringify({
      app: 'mvxsafe',
      safes: [
        { name: 'Treasury', address: STRANGER },
        { name: 'Treasury', address: ANOTHER }
      ]
    })
  );
  expect(renamed).toBe(2);
  expect(getAllSafes().map((safe) => safe.name)).toEqual([
    'Treasury',
    'Treasury (imported)',
    'Treasury (imported 2)'
  ]);
});

test('a long name keeps its mark when the list is read back', () => {
  const long = 'T'.repeat(60);
  addSafe({ name: long, address: ANOTHER });
  importSafes(
    JSON.stringify({
      app: 'mvxsafe',
      safes: [{ name: long, address: STRANGER }]
    })
  );
  const names = getAllSafes().map((safe) => safe.name);
  expect(names[2]).toMatch(/ \(imported\)$/);
  expect(new Set(names).size).toBe(3);
});

test('a safe added under a name in use never becomes a second one of that name', () => {
  addSafe({ name: 'Treasury', address: STRANGER });
  expect(getAllSafes().map((safe) => safe.name)).toEqual([
    'Treasury',
    'Treasury (2)'
  ]);
  expect(nameInUse('treasury ')).toBe(true);
  expect(nameInUse('Grants')).toBe(false);
});

test('control: adding under a new name keeps it', () => {
  addSafe({ name: 'Grants', address: STRANGER });
  expect(getAllSafes().map((safe) => safe.name)).toEqual([
    'Treasury',
    'Grants'
  ]);
});
