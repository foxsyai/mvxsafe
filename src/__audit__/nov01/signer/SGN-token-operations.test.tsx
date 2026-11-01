// What SGN-02, 03 and 04 do not pin: every token operation in its sentence, the
// real question of who owns the token, and that what is not known stays raw.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({
  proposeCall: jest.fn(async () => 'session')
}));

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { Address } from '@multiversx/sdk-core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CallForm } from 'components/Propose/CallForm';
import { describeAction } from 'multisig/describe';
import { inspectAction } from 'multisig/inspect';
import {
  contract,
  contractsNetworkMock,
  mockAccounts,
  mockTrial
} from '../../../multisig/tests/contractsMock';
import { ALICE, CAROL, ESDT_SYSTEM_SC, SAFE } from '../../display/fixtures';

const TOKEN = 'TOKEN-abc123';
const u8 = (text: string) => Uint8Array.from(Buffer.from(text));
const pk = (who: string) => Address.newFromBech32(who).getPublicKey();
const call = (endpoint: string, args: Uint8Array[], to = ESDT_SYSTEM_SC) => ({
  name: 'SendAsyncCall',
  fields: [
    { to, egld_amount: 0n, endpoint_name: u8(endpoint), arguments: args }
  ]
});
const sentenceOf = (endpoint: string, args: Uint8Array[]) =>
  describeAction(call(endpoint, args), SAFE);
const checksOf = async (endpoint: string, args: Uint8Array[]) =>
  (await inspectAction(call(endpoint, args), SAFE)).checks;

const baseApi = contractsNetworkMock.api;
let tokenOwner: () => string;
beforeEach(() => {
  tokenOwner = () => SAFE;
  (contractsNetworkMock as any).api = async (path: string) => {
    if (path === `/tokens/${TOKEN}`) {
      return { identifier: TOKEN, decimals: 18, owner: tokenOwner() };
    }
    return baseApi(path);
  };
  mockAccounts[ESDT_SYSTEM_SC] = contract({
    owner: ESDT_SYSTEM_SC,
    hash: '22'.repeat(32)
  });
  mockTrial.answer = async () => ({ gasLimit: 50_261_501 });
});
afterEach(() => {
  (contractsNetworkMock as any).api = baseApi;
});

describe('the sentence', () => {
  test.each([
    [
      'setSpecialRole',
      [u8(TOKEN), pk(CAROL), u8('ESDTRoleLocalBurn'), u8('ESDTRoleLocalMint')],
      `Give ${CAROL} the roles ESDTRoleLocalBurn, ESDTRoleLocalMint on the token ${TOKEN}`
    ],
    [
      'unSetSpecialRole',
      [u8(TOKEN), pk(CAROL), u8('ESDTTransferRole')],
      `Take the role ESDTTransferRole away from ${CAROL} on the token ${TOKEN}`
    ],
    [
      'pause',
      [u8(TOKEN)],
      `Pause the token ${TOKEN}: every transfer of it stops`
    ],
    ['unPause', [u8(TOKEN)], `Unpause the token ${TOKEN}`],
    [
      'freeze',
      [u8(TOKEN), pk(CAROL)],
      `Freeze what ${CAROL} holds of the token ${TOKEN}`
    ],
    [
      'unFreeze',
      [u8(TOKEN), pk(CAROL)],
      `Unfreeze what ${CAROL} holds of the token ${TOKEN}`
    ],
    [
      'wipe',
      [u8(TOKEN), pk(CAROL)],
      `Wipe what ${CAROL} holds of the token ${TOKEN}`
    ],
    [
      'transferOwnership',
      [u8(TOKEN), pk(CAROL)],
      `Hand the token ${TOKEN} over to ${CAROL}`
    ]
  ])('%s', async (endpoint, args, words) => {
    expect(await sentenceOf(endpoint, args as Uint8Array[])).toContain(words);
  });

  test('a call with the wrong number of arguments stays raw: the contract refuses it', async () => {
    expect(await sentenceOf('pause', [u8(TOKEN), u8('extra')])).toMatch(
      /^Call pause\(/
    );
    expect(await sentenceOf('freeze', [u8(TOKEN), u8('short')])).toMatch(
      /^Call freeze\(/
    );
  });
  test('a first argument that is no token stays raw', async () => {
    expect(await sentenceOf('pause', [u8('nonsense')])).toMatch(
      /^Call pause\(/
    );
  });
  test('an operation the app does not know stays raw', async () => {
    expect(await sentenceOf('stopNFTCreate', [u8(TOKEN)])).toMatch(
      /^Call stopNFTCreate\(/
    );
  });
  test("control: the same names on an ordinary contract are that contract's own", async () => {
    const OTHER =
      'erd1qqqqqqqqqqqqqpgqntmhxqa29ar4juhlprjjxaq790ykcj3uaujq2l9dzg';
    expect(
      await describeAction(call('pause', [u8(TOKEN)], OTHER), SAFE)
    ).toMatch(/^Call pause\(.* on erd1/);
  });
});

describe('controlChanges', () => {
  const lock = (...pairs: string[]) => [u8(TOKEN), ...pairs.map(u8)];

  test('every flag of a multi-flag call is described', async () => {
    const sentence = await sentenceOf(
      'controlChanges',
      lock('canMint', 'true', 'canPause', 'false', 'canAddSpecialRoles', 'true')
    );
    expect(sentence).toContain('canMint true (it can be minted)');
    expect(sentence).toContain(
      'canPause false (its owner can no longer pause)'
    );
    expect(sentence).toContain(
      'canAddSpecialRoles true (its owner can give roles'
    );
  });
  test('canUpgrade false among others: red, in the words of the upgrade path, in both places', async () => {
    const args = lock('canPause', 'true', 'canUpgrade', 'false');
    const sentence = await sentenceOf('controlChanges', args);
    expect(sentence).toContain('canPause true');
    expect(sentence).toContain('it can never be changed again, by anyone');
    const red = (await checksOf('controlChanges', args)).filter(
      (check) => check.tone === 'bad'
    );
    expect(
      red.some((check) =>
        /can never be changed again, by anyone/.test(check.text)
      )
    ).toBe(true);
  });
  test('a flag named twice ends on its last value, as the network runs them', async () => {
    const unlocks = lock('canUpgrade', 'false', 'canUpgrade', 'true');
    expect(await sentenceOf('controlChanges', unlocks)).not.toMatch(/never/);
    expect(
      (await checksOf('controlChanges', unlocks)).some((check) =>
        /locked for good/.test(check.text)
      )
    ).toBe(false);
    const locks = lock('canUpgrade', 'true', 'canUpgrade', 'false');
    expect(
      (await checksOf('controlChanges', locks)).some((check) =>
        /locked for good/.test(check.text)
      )
    ).toBe(true);
  });
  test('a flag or a value it does not know is kept as it is', async () => {
    const sentence = await sentenceOf(
      'controlChanges',
      lock('canDream', 'true', 'canPause', 'maybe')
    );
    expect(sentence).toContain('canDream true');
    expect(sentence).toContain('canPause maybe');
  });
  test('an odd number of arguments stays raw', async () => {
    expect(
      await sentenceOf('controlChanges', lock('canPause', 'true', 'canWipe'))
    ).toMatch(/^Call controlChanges\(/);
  });
});

describe('the facts', () => {
  test('ESDTTransferRole, among other roles: the exact fact, in red', async () => {
    const checks = await checksOf('setSpecialRole', [
      u8(TOKEN),
      pk(CAROL),
      u8('ESDTRoleLocalBurn'),
      u8('ESDTTransferRole')
    ]);
    expect(
      checks.find((check) => /While any address holds/.test(check.text))
    ).toMatchObject({
      tone: 'bad',
      text: `While any address holds ESDTTransferRole, every ordinary transfer of ${TOKEN} stops for everyone unless the sender or the receiver holds the role, until the last one is removed.`
    });
  });
  test('ESDTRoleLocalMint: that address can mint any amount', async () => {
    const checks = await checksOf('setSpecialRole', [
      u8(TOKEN),
      pk(CAROL),
      u8('ESDTRoleLocalMint')
    ]);
    expect(
      checks.some(
        (check) =>
          check.tone === 'bad' &&
          check.text === `${CAROL} can then mint any amount of ${TOKEN}.`
      )
    ).toBe(true);
  });
  test('removing the transfer role is not said to halt anything', async () => {
    const checks = await checksOf('unSetSpecialRole', [
      u8(TOKEN),
      pk(CAROL),
      u8('ESDTTransferRole')
    ]);
    expect(checks.some((check) => /stops for everyone/.test(check.text))).toBe(
      false
    );
    expect(checks.some((check) => /run again only once/.test(check.text))).toBe(
      true
    );
  });
});

describe('does the safe own this token?', () => {
  const OWNER_LINE =
    /^(The safe owns|The safe does not own|Whether the safe owns)/;
  const ownerLine = async () =>
    (await checksOf('pause', [u8(TOKEN)])).find((check) =>
      OWNER_LINE.test(check.text)
    );

  test('it does', async () => {
    expect(await ownerLine()).toMatchObject({
      tone: 'ok',
      text: `The safe owns ${TOKEN}, and only the owner of a token can do this.`
    });
  });
  test('it does not: the real owner, and never the system contract', async () => {
    tokenOwner = () => CAROL;
    const line = await ownerLine();
    expect(line?.tone).toBe('warn');
    expect(line?.text).toContain(`its owner is ${CAROL}`);
    expect(line?.text).not.toContain(ESDT_SYSTEM_SC);
  });
  test('unread: it says so', async () => {
    tokenOwner = () => {
      throw new Error('answered 500');
    };
    expect((await ownerLine())?.text).toMatch(/could not be read just now/);
  });
  test('a collection answers under /collections', async () => {
    (contractsNetworkMock as any).api = async (path: string) => {
      if (path === `/collections/${TOKEN}`) return { owner: SAFE };
      throw new Error(`${path} answered 404`);
    };
    expect((await ownerLine())?.tone).toBe('ok');
  });
  test('a system contract call with no token asks nothing, and claims nothing', async () => {
    const checks = await checksOf('getContractConfig', []);
    expect(checks.some((check) => OWNER_LINE.test(check.text))).toBe(false);
  });
});

test('the form: no false owner line for a system contract, the facts under the sentence', async () => {
  tokenOwner = () => CAROL;
  render(
    <CallForm
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onProposed={jest.fn()}
    />
  );
  fireEvent.change(screen.getByPlaceholderText('erd1qqqqqqqqqqqqqpgq...'), {
    target: { value: ESDT_SYSTEM_SC }
  });
  fireEvent.change(screen.getByPlaceholderText('setFee'), {
    target: { value: 'pause' }
  });
  fireEvent.click(screen.getByText('+ add an argument'));
  fireEvent.change(screen.getAllByLabelText('Kind of argument')[0], {
    target: { value: 'text' }
  });
  fireEvent.change(screen.getByLabelText('Argument 1'), {
    target: { value: TOKEN }
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 1000)));
  expect(screen.queryByText(/Owner-only functions will refuse it/)).toBeNull();
  expect(screen.getByText(/^Pause the token/)).toBeInTheDocument();
  expect(screen.getByText(/While .* is paused/)).toHaveAttribute(
    'data-tone',
    'bad'
  );
  expect(screen.getByText(new RegExp(`its owner is ${CAROL}`))).toHaveAttribute(
    'data-tone',
    'warn'
  );
});
