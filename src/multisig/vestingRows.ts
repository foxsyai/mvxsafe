// The rows of a vesting batch as a person types or pastes them: one line per
// tranche, "beneficiary, date, amount", the date in UTC. A spreadsheet's rows
// paste straight in (commas, semicolons or tabs). Nothing is guessed: a line
// that does not read cleanly is refused with its number.

import { normalizeBech32, parseAddress, toRawAmount } from './legacyCalls';
import { NewVesting, trancheSchedule } from './vesting';

export interface ParsedRows {
  entries: NewVesting[];
  /** '' when every line read; otherwise the first line that did not, and why. */
  problem: string;
  /** Tranche lines read. */
  tranches: number;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?(?:\s*UTC|Z)?$/i;

/** "2027-05-01" or "2027-05-01 12:00", in UTC, as seconds; null when it is not one. */
export const parseUtcDate = (text: string): number | null => {
  const match = DATE.exec(text.trim());
  if (!match) return null;
  const [, y, m, d, hh = '00', mm = '00'] = match;
  const [year, month, day, hour, minute] = [y, m, d, hh, mm].map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const back = new Date(ms);
  // 2027-02-30 is not a day: Date.UTC would quietly make it 2 March.
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  )
    return null;
  return ms / 1000;
};

/** A date as the rows write it back: 2027-05-01 or 2027-05-01 12:30. */
export const formatUtcDate = (seconds: number): string => {
  const iso = new Date(seconds * 1000).toISOString();
  const time = iso.slice(11, 16);
  return time === '00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`;
};

/** The rows typed or pasted, as vestings, one per beneficiary in order of appearance. */
export const parseVestingRows = (
  text: string,
  decimals: number
): ParsedRows => {
  const byBeneficiary = new Map<string, { time: number; amount: bigint }[]>();
  let tranches = 0;
  const lines = text.split(/\r?\n/);
  for (const [at, raw] of lines.entries()) {
    const line = raw.trim();
    const where = `Line ${at + 1}`;
    if (!line || line.startsWith('#')) continue;
    const cells = line.split(/\s*[,;\t]\s*/);
    // A header row from a spreadsheet.
    if (
      at === 0 &&
      !/^erd1/i.test(cells[0]) &&
      /address|beneficiary/i.test(line)
    )
      continue;
    if (cells.length !== 3) {
      return {
        entries: [],
        tranches,
        problem: `${where} has ${cells.length} values, where it needs three: beneficiary, date, amount. Write amounts with a dot for decimals and no thousands separators.`
      };
    }
    const [who, date, amount] = cells;
    let beneficiary: string;
    try {
      beneficiary = parseAddress(
        normalizeBech32(who),
        'beneficiary'
      ).toBech32();
    } catch (error: any) {
      return { entries: [], tranches, problem: `${where}: ${error.message}` };
    }
    const time = parseUtcDate(date);
    if (time === null) {
      return {
        entries: [],
        tranches,
        problem: `${where}: "${date}" is not a date. Write it as 2027-05-01, or 2027-05-01 12:00, in UTC.`
      };
    }
    let raw_amount: bigint;
    try {
      raw_amount = toRawAmount(amount, decimals);
    } catch (error: any) {
      return { entries: [], tranches, problem: `${where}: ${error.message}` };
    }
    const list = byBeneficiary.get(beneficiary) ?? [];
    if (list.some((tranche) => tranche.time === time)) {
      return {
        entries: [],
        tranches,
        problem: `${where}: ${beneficiary} already has a tranche on ${formatUtcDate(time)}. Put the two in one line.`
      };
    }
    list.push({ time, amount: raw_amount });
    byBeneficiary.set(beneficiary, list);
    tranches++;
  }
  return {
    entries: [...byBeneficiary.entries()].map(([beneficiary, list]) => ({
      beneficiary,
      schedule: trancheSchedule([...list].sort((a, b) => a.time - b.time))
    })),
    tranches,
    problem: ''
  };
};

/** The day `months` after a date, on the same day of the month or its last. */
const addMonths = (seconds: number, months: number): number => {
  const date = new Date(seconds * 1000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return (
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), last),
      date.getUTCHours(),
      date.getUTCMinutes()
    ) / 1000
  );
};

/**
 * Lines for one beneficiary: `count` equal tranches of `total`, `everyMonths`
 * apart from `first`, the rounding remainder in the last, as the rows read them.
 */
export const scheduleLines = ({
  beneficiary,
  total,
  decimals,
  first,
  count,
  everyMonths
}: {
  beneficiary: string;
  total: string;
  decimals: number;
  first: string;
  count: number;
  everyMonths: number;
}): { lines: string; problem: string } => {
  let address: string;
  try {
    address = parseAddress(
      normalizeBech32(beneficiary),
      'beneficiary'
    ).toBech32();
  } catch (error: any) {
    return { lines: '', problem: error.message };
  }
  const start = parseUtcDate(first);
  if (start === null)
    return {
      lines: '',
      problem: `"${first}" is not a date. Write it as 2027-05-01, in UTC.`
    };
  if (!Number.isInteger(count) || count < 1 || count > 120)
    return { lines: '', problem: 'Between 1 and 120 tranches.' };
  if (!Number.isInteger(everyMonths) || everyMonths < 1 || everyMonths > 120)
    return { lines: '', problem: 'Every 1 to 120 months.' };
  let raw: bigint;
  try {
    raw = toRawAmount(total, decimals);
  } catch (error: any) {
    return { lines: '', problem: error.message };
  }
  if (raw < BigInt(count))
    return {
      lines: '',
      problem: 'The total is too small to split into that many tranches.'
    };
  const share = raw / BigInt(count);
  const format = (value: bigint) => {
    const scale = 10n ** BigInt(decimals);
    const fraction = (value % scale)
      .toString()
      .padStart(decimals, '0')
      .replace(/0+$/, '');
    return `${value / scale}${fraction ? `.${fraction}` : ''}`;
  };
  const lines = Array.from({ length: count }, (_, at) => {
    const amount = at === count - 1 ? raw - share * BigInt(count - 1) : share;
    return `${address}, ${formatUtcDate(addMonths(start, at * everyMonths))}, ${format(amount)}`;
  });
  return { lines: lines.join('\n'), problem: '' };
};
