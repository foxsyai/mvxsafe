/**
 * @jest-environment node
 */
// The rows of a vesting batch as typed or pasted: one tranche a line, UTC
// dates, nothing guessed.
import {
  formatUtcDate,
  parseUtcDate,
  parseVestingRows,
  scheduleLines
} from 'multisig/vestingRows';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const BOB = 'erd1cus9zpgyg8ztpvr48j8w8lqack3u7gtlnxlum22cdl0k0vfwm3eq54npug';
const UNIT = 10n ** 18n;
const at = (iso: string) => Date.parse(iso) / 1000;

describe('dates, in UTC', () => {
  it('a day, or a day and a time', () => {
    expect(parseUtcDate('2027-05-01')).toBe(at('2027-05-01T00:00:00Z'));
    expect(parseUtcDate('2027-05-01 12:30')).toBe(at('2027-05-01T12:30:00Z'));
    expect(parseUtcDate('2027-05-01T12:30Z')).toBe(at('2027-05-01T12:30:00Z'));
    expect(parseUtcDate(' 2027-05-01 12:30 UTC ')).toBe(
      at('2027-05-01T12:30:00Z')
    );
  });

  it('nothing that is not a real day', () => {
    for (const text of [
      '2027-02-30',
      '2027-13-01',
      '01/05/2027',
      '2027-05-01 24:00',
      'May 1',
      ''
    ])
      expect(parseUtcDate(text)).toBeNull();
  });

  it('written back the same way', () => {
    expect(formatUtcDate(at('2027-05-01T00:00:00Z'))).toBe('2027-05-01');
    expect(formatUtcDate(at('2027-05-01T12:30:00Z'))).toBe('2027-05-01 12:30');
  });
});

describe('the rows', () => {
  it('group by beneficiary in order of appearance, tranches by date', () => {
    const parsed = parseVestingRows(
      [
        'beneficiary, date, amount',
        `${BOB}, 2027-11-01, 6`,
        `${ALICE}; 2027-05-01; 1.5`,
        `${BOB}\t2027-05-01\t4`,
        '# a comment',
        ''
      ].join('\n'),
      18
    );
    expect(parsed.problem).toBe('');
    expect(parsed.tranches).toBe(3);
    expect(parsed.entries.map((entry) => entry.beneficiary)).toEqual([
      BOB,
      ALICE
    ]);
    const bob = parsed.entries[0].schedule;
    expect(bob.curve).toEqual({
      kind: 'tranches',
      tranches: [
        { time: at('2027-05-01T00:00:00Z'), amount: 4n * UNIT },
        { time: at('2027-11-01T00:00:00Z'), amount: 6n * UNIT }
      ]
    });
    expect(bob.start).toBe(at('2027-05-01T00:00:00Z'));
    expect(bob.end).toBe(at('2027-11-01T00:00:00Z'));
  });

  it('refuse a thousands separator rather than read 1,000 as 1', () => {
    expect(parseVestingRows(`${ALICE}, 2027-05-01, 1,000`, 18).problem).toMatch(
      /Line 1 has 4 values/
    );
  });

  it('refuse a bad address, date or amount, with the line number', () => {
    expect(
      parseVestingRows(`\n${ALICE.slice(0, -1)}q, 2027-05-01, 1`, 18).problem
    ).toMatch(/^Line 2: That is not a valid MultiversX beneficiary/);
    expect(parseVestingRows(`${ALICE}, 1 May 2027, 1`, 18).problem).toMatch(
      /^Line 1: "1 May 2027" is not a date/
    );
    expect(
      parseVestingRows(`${ALICE}, 2027-05-01, 1.0000001`, 6).problem
    ).toMatch(/^Line 1: This token has 6 decimals/);
  });

  it('refuse two tranches of one person on the same date', () => {
    expect(
      parseVestingRows(`${ALICE}, 2027-05-01, 1\n${ALICE}, 2027-05-01, 2`, 18)
        .problem
    ).toMatch(/already has a tranche on 2027-05-01/);
  });

  it('accept an address in capitals, as a QR code carries it', () => {
    expect(
      parseVestingRows(`${ALICE.toUpperCase()}, 2027-05-01, 1`, 18).entries[0]
        .beneficiary
    ).toBe(ALICE);
  });
});

describe('a schedule for one person', () => {
  it('equal tranches every six months, the remainder in the last', () => {
    const { lines, problem } = scheduleLines({
      beneficiary: ALICE,
      total: '100',
      decimals: 0,
      first: '2027-01-31',
      count: 3,
      everyMonths: 6
    });
    expect(problem).toBe('');
    // 31 July exists; 31 January + 12 months is 31 January again.
    expect(lines).toBe(
      [
        `${ALICE}, 2027-01-31, 33`,
        `${ALICE}, 2027-07-31, 33`,
        `${ALICE}, 2028-01-31, 34`
      ].join('\n')
    );
    expect(parseVestingRows(lines, 0).entries[0].schedule.curve).toMatchObject({
      kind: 'tranches'
    });
  });

  it('the last day of a shorter month, never the next month', () => {
    const { lines } = scheduleLines({
      beneficiary: ALICE,
      total: '2',
      decimals: 0,
      first: '2027-08-31',
      count: 2,
      everyMonths: 6
    });
    expect(lines.split('\n')[1]).toBe(`${ALICE}, 2028-02-29, 1`);
  });

  it('refuses what cannot be split', () => {
    expect(
      scheduleLines({
        beneficiary: ALICE,
        total: '0.000000000000000001',
        decimals: 18,
        first: '2027-01-01',
        count: 2,
        everyMonths: 6
      }).problem
    ).toMatch(/too small/);
    expect(
      scheduleLines({
        beneficiary: ALICE,
        total: '1',
        decimals: 18,
        first: 'soon',
        count: 2,
        everyMonths: 6
      }).problem
    ).toMatch(/not a date/);
  });
});
