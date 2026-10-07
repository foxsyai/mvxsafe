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

const ADDRESS = /^erd1[02-9ac-hj-np-z]{58}$/;

/**
 * Only string labels for erd1 keys, in an object with no prototype. A plain
 * object answered getLabel('__proto__') with Object.prototype, and React then
 * unmounted the whole app on /safe/__proto__ (web audit WEB-03 and WEB-05).
 */
const clean = (value: unknown): Labels => {
  const labels: Labels = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return labels;
  for (const [address, label] of Object.entries(value as Record<string, unknown>)) {
    if (ADDRESS.test(address) && typeof label === 'string' && label.trim()) {
      labels[address] = label.trim().slice(0, 40);
    }
  }
  return labels;
};

const read = (): Labels => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return clean(raw ? JSON.parse(raw) : {});
  } catch {
    return clean({});
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

export const getLabel = (address: string): string => {
  const labels = read();
  return Object.prototype.hasOwnProperty.call(labels, address) ? labels[address] : '';
};

export const setLabel = (address: string, label: string) => {
  if (!ADDRESS.test(address)) return;
  const labels = read();
  const trimmed = label.trim().slice(0, 40);
  if (trimmed) labels[address] = trimmed;
  else delete labels[address];
  write(labels);
  // Components read this through a hook that listens for the event below, so a
  // name typed in one place appears everywhere at once.
  window.dispatchEvent(new CustomEvent('mvxsafe:labels'));
};

export const mergeLabels = (incoming: unknown): number => {
  const fresh = clean(incoming);
  const labels = read();
  let added = 0;
  for (const [address, label] of Object.entries(fresh)) {
    if (Object.prototype.hasOwnProperty.call(labels, address)) continue;
    labels[address] = label;
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
    // api() queues and caches by itself; wrapping it in cached() again held a
    // queue slot while waiting for another, which deadlocked a list of eight.
    const account = await api<{ username?: string }>(`/accounts/${address}?fields=username`);
    return account?.username ?? '';
  } catch {
    return '';
  }
};
