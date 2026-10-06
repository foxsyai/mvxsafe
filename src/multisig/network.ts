// Everything this app knows about the chain. There is no backend: the browser
// reads the public MultiversX API directly, so two rules shape this file.
//
// 1. The API allows about two requests per second per IP, and that IP is the
//    visitor's own. A safe page needs a dozen reads, so requests go through a
//    small queue with a cache rather than firing at once.
// 2. Reads are cheap but not free. Anything already fetched in the last minute
//    is reused, which makes moving between the list and a safe feel instant.

import { ApiNetworkProvider } from '@multiversx/sdk-core';
import { environment } from 'config';

const API_BY_NETWORK: Record<string, string> = {
  mainnet: 'https://api.multiversx.com',
  devnet: 'https://devnet-api.multiversx.com',
  testnet: 'https://testnet-api.multiversx.com'
};

const CHAIN_ID_BY_NETWORK: Record<string, string> = {
  mainnet: '1',
  devnet: 'D',
  testnet: 'T'
};

export const networkName = String(environment);
export const apiUrl = API_BY_NETWORK[networkName] ?? API_BY_NETWORK.mainnet;
export const chainId = CHAIN_ID_BY_NETWORK[networkName] ?? '1';
export const explorerUrl =
  networkName === 'mainnet'
    ? 'https://explorer.multiversx.com'
    : `https://${networkName}-explorer.multiversx.com`;

export const networkProvider = new ApiNetworkProvider(apiUrl, {
  clientName: 'mvxsafe.io',
  timeout: 15000
});

// --- the queue and the cache -------------------------------------------------

const CACHE_MS = 60_000;
const MAX_IN_FLIGHT = 3;

interface CacheEntry {
  at: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const queue: (() => void)[] = [];
let inFlight = 0;

const runNext = () => {
  if (inFlight >= MAX_IN_FLIGHT) return;
  const next = queue.shift();
  if (!next) return;
  inFlight++;
  next();
};

/**
 * Runs `work` behind the queue and remembers its result under `key` for a
 * minute. Two components asking for the same thing share one request.
 */
export const cached = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;

  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      work()
        .then((value) => {
          cache.set(key, { at: Date.now(), value });
          resolve(value);
        })
        .catch(reject)
        .finally(() => {
          inFlight--;
          runNext();
        });
    });
    runNext();
  });
};

/** Drops everything cached, so a Refresh button really refetches. */
export const clearCache = () => cache.clear();

export const api = async <T>(path: string): Promise<T> =>
  cached(`api:${path}`, async () => {
    const response = await fetch(`${apiUrl}${path}`);
    if (!response.ok) {
      throw new Error(`${path} answered ${response.status}`);
    }
    return (await response.json()) as T;
  });
