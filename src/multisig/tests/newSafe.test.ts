import { checkBoard, isAccountAddress, majority } from 'multisig/newSafe';

const COO = 'erd1etc22n3wel7s452mkvfy2aw3zpef7lmdkkyv9xcryzssdcpahlnsvnzga0';
const CTO = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const CEO = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const TREASURY = 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';

describe('a new board', () => {
  it('accepts the Foundation board at two of three', () => {
    const check = checkBoard([COO, CTO, CEO], 2, CEO);
    expect(check.blocker).toBe('');
    expect(check.board).toEqual([COO, CTO, CEO]);
    expect(check.warnings).toEqual([]);
  });

  it('catches a single mistyped character through the checksum', () => {
    const typo = CTO.slice(0, 20) + (CTO[20] === 'q' ? 'p' : 'q') + CTO.slice(21);
    expect(isAccountAddress(typo)).toBe(false);
    const check = checkBoard([COO, typo, CEO], 2);
    expect(check.rowErrors[1]).toMatch(/Not a valid/);
    expect(check.blocker).toMatch(/Fix the addresses/);
  });

  it('refuses hex, uppercase, other prefixes and junk', () => {
    for (const bad of [
      'a202c5ad86e367d59bbb0a5477a3ebd87a847c23e817e5349fbb0d94d47bea11',
      CEO.toUpperCase(),
      CEO.replace('erd1', 'xyz1'),
      `${CEO} `.repeat(2),
      'erd1'
    ]) {
      expect(isAccountAddress(bad.trim())).toBe(false);
    }
  });

  it('flags a duplicate and blocks', () => {
    const check = checkBoard([COO, CEO, COO], 2);
    expect(check.rowErrors).toEqual(['', '', 'Already on the board.']);
    expect(check.board).toEqual([COO, CEO]);
    expect(check.blocker).not.toBe('');
  });

  it('drops blank rows and trims spaces', () => {
    const check = checkBoard(['', `  ${COO} `, '', CEO], 2);
    expect(check.board).toEqual([COO, CEO]);
    expect(check.blocker).toBe('');
  });

  it('keeps the quorum between 1 and the board size', () => {
    expect(checkBoard([COO, CEO], 0).blocker).toMatch(/between 1 and 2/);
    expect(checkBoard([COO, CEO], 3).blocker).toMatch(/between 1 and 2/);
    expect(checkBoard([COO, CEO], 1.5).blocker).toMatch(/between 1 and 2/);
    expect(checkBoard([], 1).blocker).toMatch(/at least one/);
  });

  it('warns about one-person control, a quorum nobody can lose, contracts and absent creators', () => {
    expect(checkBoard([COO, CEO], 1).warnings.join(' ')).toMatch(/any single member/);
    expect(checkBoard([COO, CEO], 2).warnings.join(' ')).toMatch(/one wallet is ever lost/);
    expect(checkBoard([TREASURY, CEO], 1).warnings.join(' ')).toMatch(/smart contract/);
    expect(checkBoard([COO, CTO], 2, CEO).warnings.join(' ')).toMatch(/not on this board/);
  });

  it('starts at a majority', () => {
    expect([1, 2, 3, 4, 5].map(majority)).toEqual([1, 2, 2, 3, 3]);
  });
});
