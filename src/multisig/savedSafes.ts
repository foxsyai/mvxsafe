// The safes a visitor has added, kept in their own browser. There is no
// account and no server here: the Foundation's seven are compiled in, anything
// else belongs to whoever typed it and never leaves their machine.

import { FOUNDATION_SAFES, KnownSafe } from 'config/safes';

const STORAGE_KEY = 'mvxsafe.savedSafes';

const read = (): KnownSafe[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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
  if (saved.some((entry) => entry.address === safe.address)) return;
  write([...saved, safe]);
};

export const removeSafe = (address: string) => {
  write(read().filter((safe) => safe.address !== address));
};

export const isFoundationSafe = (address: string) =>
  FOUNDATION_SAFES.some((safe) => safe.address === address);

export const nameFor = (address: string) =>
  getAllSafes().find((safe) => safe.address === address)?.name ?? '';

export const isValidSafeAddress = (address: string) =>
  /^erd1[0-9a-z]{58}$/.test(address.trim());

/**
 * The list as a file, so it can move to another browser or another machine.
 * Plain JSON, name and address, readable and editable by hand: there is no
 * server to keep it on and nothing here is secret.
 */
export const exportSafes = (): string =>
  JSON.stringify({ app: 'mvxsafe', safes: getAllSafes() }, null, 2);

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

  let added = 0;
  let skipped = 0;
  for (const entry of incoming) {
    const address = String(entry?.address ?? '').trim();
    if (!isValidSafeAddress(address)) {
      skipped++;
      continue;
    }
    const before = getAllSafes().length;
    addSafe({ name: String(entry?.name ?? 'Safe').slice(0, 60), address });
    if (getAllSafes().length > before) added++;
    else skipped++;
  }
  return { added, skipped };
};
