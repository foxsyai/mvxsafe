// The safes a visitor has added, kept in their own browser. There is no
// account and no server here: the Foundation's seven are compiled in, anything
// else belongs to whoever typed it and never leaves their machine.

import { Address } from '@multiversx/sdk-core';
import { FOUNDATION_SAFES, KnownSafe } from 'config/safes';
import { getLabels, mergeLabels } from './addressBook';

const STORAGE_KEY = 'mvxsafe.savedSafes';

/** More than anyone watches; a bigger import is cut here instead of freezing the tab. */
export const MAX_SAFES = 500;

/**
 * An erd1 address with a valid checksum. The old pattern accepted any 58
 * lowercase characters, so a mistyped address was added and then simply never
 * loaded (web audit WEB-04, 7 Oct 2026).
 */
export const isValidSafeAddress = (address: string) => {
  const text = String(address ?? '').trim();
  return /^erd1[02-9ac-hj-np-z]{58}$/.test(text) && Address.isValid(text);
};

const nameOf = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.slice(0, 60) : 'Safe';

/**
 * Only what a list of safes can contain: a name and a valid address, each once.
 * Storage is the visitor's own and can hold anything (another tab, an
 * extension, a hand edit), and one null in it used to take the page down (WEB-05).
 */
const clean = (value: unknown): KnownSafe[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const safes: KnownSafe[] = [];
  for (const entry of value) {
    const address = typeof entry?.address === 'string' ? entry.address.trim() : '';
    if (!isValidSafeAddress(address) || seen.has(address)) continue;
    seen.add(address);
    safes.push({ name: nameOf(entry.name), address });
  }
  return safes;
};

const read = (): KnownSafe[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? clean(JSON.parse(raw)) : [];
  } catch {
    // Private windows and blocked storage throw rather than return null.
    return [];
  }
};

const write = (safes: KnownSafe[]) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safes));
  } catch {
    // Nothing to do: the list simply does not persist in this browser.
  }
};

export const getSavedSafes = (): KnownSafe[] => read();

/**
 * Every visitor starts empty and adds their own safes: this is a tool for
 * anyone on MultiversX, not a page about the Foundation (Sebastian, 6 Oct 2026).
 * FOUNDATION_SAFES stays in the code for the next milestone, where connecting a
 * wallet shows the safes whose board the connected address sits on.
 */
export const getAllSafes = (): KnownSafe[] => read();

export const addSafe = (safe: KnownSafe) => {
  const saved = read();
  if (!isValidSafeAddress(safe.address)) return;
  if (saved.some((entry) => entry.address === safe.address)) return;
  write([...saved, { name: nameOf(safe.name), address: safe.address.trim() }]);
};

export const removeSafe = (address: string) => {
  write(read().filter((safe) => safe.address !== address));
};

export const isFoundationSafe = (address: string) =>
  FOUNDATION_SAFES.some((safe) => safe.address === address);

export const nameFor = (address: string) =>
  getAllSafes().find((safe) => safe.address === address)?.name ?? '';

/**
 * The list as a file, so it can move to another browser or another machine.
 * Plain JSON, name and address, readable and editable by hand: there is no
 * server to keep it on and nothing here is secret.
 */
export const exportSafes = (): string =>
  JSON.stringify(
    { app: 'mvxsafe', safes: getAllSafes(), labels: getLabels() },
    null,
    2
  );

/**
 * Adds the safes in an exported file. Read once, merged in memory, written
 * once: adding them one by one re-read and re-wrote the whole list each time,
 * and 6,000 entries took 13 seconds of frozen tab (WEB-09).
 */
export const importSafes = (text: string): { added: number; skipped: number } => {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not JSON.');
  }
  const incoming = Array.isArray(parsed) ? parsed : parsed?.safes;
  if (!Array.isArray(incoming)) {
    throw new Error('That file holds no list of safes.');
  }

  mergeLabels(parsed?.labels);

  const list = read();
  const known = new Set(list.map((safe) => safe.address));
  let added = 0;
  let skipped = 0;
  for (const entry of incoming) {
    const address = typeof entry?.address === 'string' ? entry.address.trim() : '';
    if (!isValidSafeAddress(address) || known.has(address) || list.length >= MAX_SAFES) {
      skipped++;
      continue;
    }
    known.add(address);
    list.push({ name: nameOf(entry?.name), address });
    added++;
  }
  if (added > 0) write(list);
  return { added, skipped };
};
