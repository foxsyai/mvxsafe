// The rules for a new safe's board, kept out of the page so they can be tested.
// A wrong address on a board is a seat nobody can ever use, and a careless
// quorum either hands everything to one person or locks it forever, so this
// checks hard and explains in plain words.

import { Address } from '@multiversx/sdk-core';

/** Deploy gas covers far more, but a board this size is already unusual. */
export const MAX_BOARD = 20;

export interface BoardCheck {
  /** The members that will be written, in the order given, blank rows dropped. */
  board: string[];
  /** One message per row, empty when the row is fine or blank. */
  rowErrors: string[];
  /** Notes that do not block creating the safe. */
  warnings: string[];
  /** Why the safe cannot be created yet, or empty when it can. */
  blocker: string;
}

/** More than half: the usual choice, and what the form starts with. */
export const majority = (size: number) => Math.floor(size / 2) + 1;

const isContractAddress = (address: string) => address.startsWith('erd1qqqqqqqqqqqqqpgq');

/**
 * A MultiversX account address, checksum included, in the lowercase form the
 * network uses. The checksum is what catches a mistyped character.
 */
export const isAccountAddress = (value: string) =>
  /^erd1[02-9ac-hj-np-z]{58}$/.test(value) && Address.isValid(value);

export const checkBoard = (rows: string[], quorum: number, me = ''): BoardCheck => {
  const values = rows.map((row) => row.trim());
  const seen = new Set<string>();
  const rowErrors = values.map((value) => {
    if (!value) return '';
    if (!isAccountAddress(value)) {
      return 'Not a valid MultiversX address. Check every character.';
    }
    if (seen.has(value)) return 'Already on the board.';
    seen.add(value);
    return '';
  });
  const board = values.filter((value, index) => value && !rowErrors[index]);

  const warnings: string[] = [];
  for (const member of board) {
    if (isContractAddress(member)) {
      warnings.push(
        `${member.slice(0, 12)}...${member.slice(-6)} is a smart contract, which cannot sign from a wallet. Keep it only if you know it can call this safe.`
      );
    }
  }
  if (me && board.length > 0 && !board.includes(me)) {
    warnings.push(
      'You are not on this board: you pay for creating it, but you will not be able to sign for it.'
    );
  }
  if (board.length > 1 && quorum === 1) {
    warnings.push('With one signature needed, any single member can move everything alone.');
  }
  if (board.length > 1 && quorum === board.length) {
    warnings.push(
      'Every member has to sign everything: if one wallet is ever lost, nothing in this safe can move again.'
    );
  }

  let blocker = '';
  if (rowErrors.some(Boolean)) blocker = 'Fix the addresses marked in red.';
  else if (board.length === 0) blocker = 'Add at least one board member.';
  else if (board.length > MAX_BOARD) blocker = `A board can have at most ${MAX_BOARD} members here.`;
  else if (!Number.isInteger(quorum) || quorum < 1 || quorum > board.length) {
    blocker = `The number of signatures has to be between 1 and ${board.length}.`;
  }

  return { board, rowErrors, warnings, blocker };
};
