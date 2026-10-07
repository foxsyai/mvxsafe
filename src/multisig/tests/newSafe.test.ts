import { checkBoard, isAccountAddress, majority } from 'multisig/newSafe';

const ERIN = 'erd1etc22n3wel7s452mkvfy2aw3zpef7lmdkkyv9xcryzssdcpahlnsvnzga0';
const CAROL = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const ALICE = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const CONTRACT = 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';

describe('a new board', () => {
  it('accepts a board of three at two of three', () => {
    const check = checkBoard([ERIN, CAROL, ALICE], 2, ALICE);
    expect(check.blocker).toBe('');
    expect(check.board).toEqual([ERIN, CAROL, ALICE]);
    expect(check.warnings).toEqual([]);
  });

  it('catches a single mistyped character through the checksum', () => {
    const typo = CAROL.slice(0, 20) + (CAROL[20] === 'q' ? 'p' : 'q') + CAROL.slice(21);
    expect(isAccountAddress(typo)).toBe(false);
    const check = checkBoard([ERIN, typo, ALICE], 2);
    expect(check.rowErrors[1]).toMatch(/Not a valid/);
    expect(check.blocker).toMatch(/Fix the addresses/);
  });

  it('refuses hex, uppercase, other prefixes and junk', () => {
    for (const bad of [
      'a202c5ad86e367d59bbb0a5477a3ebd87a847c23e817e5349fbb0d94d47bea11',
      ALICE.toUpperCase(),
      ALICE.replace('erd1', 'xyz1'),
      `${ALICE} `.repeat(2),
      'erd1'
    ]) {
      expect(isAccountAddress(bad.trim())).toBe(false);
    }
  });

  it('flags a duplicate and blocks', () => {
    const check = checkBoard([ERIN, ALICE, ERIN], 2);
    expect(check.rowErrors).toEqual(['', '', 'Already on the board.']);
    expect(check.board).toEqual([ERIN, ALICE]);
    expect(check.blocker).not.toBe('');
  });

  it('drops blank rows and trims spaces', () => {
    const check = checkBoard(['', `  ${ERIN} `, '', ALICE], 2);
    expect(check.board).toEqual([ERIN, ALICE]);
    expect(check.blocker).toBe('');
  });

  it('keeps the quorum between 1 and the board size', () => {
    expect(checkBoard([ERIN, ALICE], 0).blocker).toMatch(/between 1 and 2/);
    expect(checkBoard([ERIN, ALICE], 3).blocker).toMatch(/between 1 and 2/);
    expect(checkBoard([ERIN, ALICE], 1.5).blocker).toMatch(/between 1 and 2/);
    expect(checkBoard([], 1).blocker).toMatch(/at least one/);
  });

  it('warns about one-person control, a quorum nobody can lose, contracts and absent creators', () => {
    expect(checkBoard([ERIN, ALICE], 1).warnings.join(' ')).toMatch(/any single member/);
    expect(checkBoard([ERIN, ALICE], 2).warnings.join(' ')).toMatch(/one wallet is ever lost/);
    expect(checkBoard([CONTRACT, ALICE], 1).warnings.join(' ')).toMatch(/smart contract/);
    expect(checkBoard([ERIN, CAROL], 2, ALICE).warnings.join(' ')).toMatch(/not on this board/);
  });

  it('starts at a majority', () => {
    expect([1, 2, 3, 4, 5].map(majority)).toEqual([1, 2, 2, 3, 3]);
  });
});
