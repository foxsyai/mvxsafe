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
// The documentation says two requests a second per address, but measured from a
// browser the API answers 20 calls in 0.3 s with no refusal, each in about
// 0.12 s. Pacing at two was making a list of seven safes take ten seconds for
// no reason. These numbers stay well under what the API tolerates, and the
// retry below covers the day it decides otherwise.
const RATE_PER_SECOND = 10;
const MAX_IN_FLIGHT = 6;
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

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** A failed API read that knows whether asking again could help. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

/**
 * True for the answers that mean "ask again later" rather than "no". An API
 * read decides on its HTTP status: the old text search also matched "502"
 * inside an address in the request path, and missed Chrome's "Failed to
 * fetch" (web audit WEB-10, 7 Oct 2026). Contract queries come back from the
 * SDK as text, so for those the numbers are matched as whole words only.
 */
const worthRetrying = (error: any) => {
  if (error instanceof ApiError) return error.retryable;
  const text = String(error?.message ?? error ?? '');
  return /\b(429|502|503|504)\b|Too Many Requests|timeout|timed out|Network|Failed to fetch/i.test(text);
};

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * fetch, but settled within REQUEST_TIMEOUT_MS whatever the connection does. A
 * stalled connection used to hold one of the six request slots for ever, and
 * six of them stopped every read in the app until a reload (WEB-06). The race
 * settles even when the request ignores the abort.
 */
const fetchWithTimeout = (url: string): Promise<Response> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError(`${url} timed out after ${REQUEST_TIMEOUT_MS / 1000} s`, undefined, true));
    }, REQUEST_TIMEOUT_MS);
  });
  return Promise.race([fetch(url, { signal: controller.signal }), timeout]).finally(() =>
    clearTimeout(timer)
  );
};

// Bumped by clearCache: an answer that was asked for before a Refresh must
// not be written over what the Refresh fetched (WEB-11).
let generation = 0;

/**
 * Runs `work` behind the queue and remembers its answer for a minute. Two
 * components asking for the same thing share one request rather than making two.
 */
export const cached = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;

  const already = inflight.get(key);
  if (already) return already as Promise<T>;

  const startedIn = generation;
  const attempt = async (): Promise<T> => {
    let lastError: unknown;
    for (let round = 0; round < MAX_ATTEMPTS; round++) {
      try {
        const value = await schedule(work);
        if (generation === startedIn) cache.set(key, { at: Date.now(), value });
        return value;
      } catch (error) {
        lastError = error;
        if (!worthRetrying(error)) break;
        await wait(600 * Math.pow(2, round));
      }
    }
    throw lastError;
  };

  const promise: Promise<T> = attempt().finally(() => {
    // Only its own entry: a read started after a Refresh may hold the key now.
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
};

/** Drops everything cached, so a Refresh button really refetches. */
export const clearCache = () => {
  generation++;
  cache.clear();
  inflight.clear();
};

/**
 * A GET on the public API, queued, retried and cached for a minute by path.
 * NEVER call it inside cached(): both queue, so the outer call holds one of
 * the six slots while waiting for another, and six of those at once stop
 * every read in the app (a list of eight safes froze on 7 Oct 2026).
 */
export const api = async <T>(path: string): Promise<T> =>
  cached(`api:${path}`, async () => {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${apiUrl}${path}`);
    } catch (failure: any) {
      if (failure instanceof ApiError) throw failure;
      // fetch rejects only when the request never got an answer: worth retrying.
      throw new ApiError(`${path}: ${failure?.message ?? 'network error'}`, undefined, true);
    }
    if (!response.ok) {
      throw new ApiError(
        `${path} answered ${response.status}`,
        response.status,
        RETRY_STATUS.has(response.status)
      );
    }
    return (await response.json()) as T;
  });
