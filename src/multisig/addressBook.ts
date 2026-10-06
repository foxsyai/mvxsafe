// Names for addresses. An erd1 address tells you nothing about whose it is, and
// a board of four is four strings that differ in the middle. So each address can
// carry a label.
//
// Two sources, in this order:
//   1. a label you typed, kept in this browser,
//   2. the account's herotag, if it has one, which the chain already knows.
//
// Labels live in local storage beside the safes and travel with them in the
// export file, because they are the only thing in this app a person actually
// authors.

import { api, cached } from './network';

const STORAGE_KEY = 'mvxsafe.labels';

type Labels = Record<string, string>;

const read = (): Labels => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const write = (labels: Labels) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // A browser that refuses storage simply does not remember the names.
  }
};

export const getLabels = (): Labels => read();

export const getLabel = (address: string): string => read()[address] ?? '';

export const setLabel = (address: string, label: string) => {
  const labels = read();
  const trimmed = label.trim().slice(0, 40);
  if (trimmed) labels[address] = trimmed;
  else delete labels[address];
  write(labels);
  // Components read this through a hook that listens for the event below, so a
  // name typed in one place appears everywhere at once.
  window.dispatchEvent(new CustomEvent('mvxsafe:labels'));
};

export const mergeLabels = (incoming: Labels): number => {
  if (!incoming || typeof incoming !== 'object') return 0;
  const labels = read();
  let added = 0;
  for (const [address, label] of Object.entries(incoming)) {
    if (typeof label !== 'string' || !label.trim()) continue;
    if (labels[address]) continue;
    labels[address] = label.trim().slice(0, 40);
    added++;
  }
  write(labels);
  window.dispatchEvent(new CustomEvent('mvxsafe:labels'));
  return added;
};

/**
 * The account's herotag, which is a name registered on chain. Read once per
 * address and kept, because it changes about never.
 */
export const readHerotag = async (address: string): Promise<string> => {
  try {
    const account = await cached(`herotag:${address}`, () =>
      api<{ username?: string }>(`/accounts/${address}?fields=username`)
    );
    return account?.username ?? '';
  } catch {
    return '';
  }
};
