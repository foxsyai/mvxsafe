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

// --- the queue, the pacing and the cache -------------------------------------
//
// The public API allows about two requests a second from one visitor and
// answers 429 beyond that. Firing a burst and ignoring the refusals left cards
// stuck on "..." and the browser retrying nothing. So: a token bucket paces the
// calls, refusals are retried with a growing wait, and answers are remembered.

const CACHE_MS = 60_000;
const RATE_PER_SECOND = 2;
const MAX_IN_FLIGHT = 2;
const MAX_ATTEMPTS = 4;

interface CacheEntry {
  at: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const queue: (() => void)[] = [];
let running = 0;
let tokens = RATE_PER_SECOND;
let lastRefill = Date.now();

const refill = () => {
  const now = Date.now();
  tokens = Math.min(RATE_PER_SECOND, tokens + ((now - lastRefill) / 1000) * RATE_PER_SECOND);
  lastRefill = now;
};

const pump = () => {
  refill();
  while (queue.length > 0 && running < MAX_IN_FLIGHT && tokens >= 1) {
    tokens -= 1;
    running++;
    (queue.shift() as () => void)();
  }
  if (queue.length > 0) {
    setTimeout(pump, 250);
  }
};

const schedule = <T>(work: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    queue.push(() => {
      work()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          running--;
          pump();
        });
    });
    pump();
  });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** True for the answers that mean "ask again later" rather than "no". */
const worthRetrying = (error: any) => {
  const text = String(error?.message ?? error ?? '');
  return (
    text.includes('429') ||
    text.includes('Too Many Requests') ||
    text.includes('timeout') ||
    text.includes('Network') ||
    text.includes('502') ||
    text.includes('503') ||
    text.includes('504')
  );
};

/**
 * Runs `work` behind the queue and remembers its answer for a minute. Two
 * components asking for the same thing share one request rather than making two.
 */
export const cached = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;

  const already = inflight.get(key);
  if (already) return already as Promise<T>;

  const attempt = async (): Promise<T> => {
    let lastError: unknown;
    for (let round = 0; round < MAX_ATTEMPTS; round++) {
      try {
        const value = await schedule(work);
        cache.set(key, { at: Date.now(), value });
        return value;
      } catch (error) {
        lastError = error;
        if (!worthRetrying(error)) break;
        await wait(600 * Math.pow(2, round));
      }
    }
    throw lastError;
  };

  const promise = attempt().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
};

/** Drops everything cached, so a Refresh button really refetches. */
export const clearCache = () => {
  cache.clear();
  inflight.clear();
};

export const api = async <T>(path: string): Promise<T> =>
  cached(`api:${path}`, async () => {
    const response = await fetch(`${apiUrl}${path}`);
    if (!response.ok) {
      throw new Error(`${path} answered ${response.status}`);
    }
    return (await response.json()) as T;
  });
