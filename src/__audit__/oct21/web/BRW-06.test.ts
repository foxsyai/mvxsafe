/**
 * BRW-06: a saved safe's NAME bypasses the name rule that labels and herotags
 * follow. Commit 1e5b57d (11 Oct 2026) routes every label through safeLabel:
 * control and format characters (zero-width, direction overrides) are removed,
 * lookalikes are folded, a name that passes for an address or mixes alphabets
 * in one word is refused. The name of a safe in the list (the h1 of its page
 * and the h2 of its card) goes through nameOf() instead, which only trims and
 * cuts at 60 characters. It enters from the import file, the Add form and the
 * Create page, and travels in the export file like a label does.
 *
 * Run, from the app folder: npx jest src/__audit__/oct21/web/BRW-06.test.ts
 */
import { addSafe, importSafes, nameFor } from 'multisig/savedSafes';
import { ALICE, BOB, CAROL, SAFE } from '../../display/fixtures';

const INVISIBLE = /[\p{Cc}\p{Cf}ᅟᅠㅤﾠ⠀]/u;
const LOOKS_LIKE_ADDRESS = /erd1[02-9ac-hj-np-z]{3}/i;
// "Pаypal" with a Cyrillic а in the middle: the lookalike trick the rule refuses.
const MIXED = 'Pаypal';

beforeEach(() => {
  window.localStorage.clear();
});

test('control: a plain name, and a name wholly in one alphabet, are kept as written', () => {
  importSafes(
    JSON.stringify({
      safes: [
        { name: 'Treasury', address: ALICE },
        { name: 'Казна', address: BOB }
      ]
    })
  );
  expect(nameFor(ALICE)).toBe('Treasury');
  expect(nameFor(BOB)).toBe('Казна');
});

test('an imported name carries no direction override or zero-width character', () => {
  importSafes(
    JSON.stringify({
      safes: [{ name: 'Treasury‮​', address: ALICE }]
    })
  );
  expect(nameFor(ALICE)).not.toMatch(INVISIBLE);
});

test('an imported name that passes for an address is not shown as one', () => {
  importSafes(JSON.stringify({ safes: [{ name: SAFE, address: BOB }] }));
  expect(nameFor(BOB)).not.toMatch(LOOKS_LIKE_ADDRESS);
});

test('an imported name mixing two alphabets in one word is refused', () => {
  importSafes(JSON.stringify({ safes: [{ name: MIXED, address: CAROL }] }));
  expect(nameFor(CAROL)).not.toBe(MIXED);
});

test('a typed name (the Add form and the Create page call addSafe) follows the same rule', () => {
  addSafe({ name: 'Team‮', address: ALICE });
  addSafe({ name: SAFE, address: BOB });
  addSafe({ name: MIXED, address: CAROL });
  expect(nameFor(ALICE)).not.toMatch(INVISIBLE);
  expect(nameFor(BOB)).not.toMatch(LOOKS_LIKE_ADDRESS);
  expect(nameFor(CAROL)).not.toBe(MIXED);
});
