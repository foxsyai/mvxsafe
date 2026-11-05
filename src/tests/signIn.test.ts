import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dAppConfig } from '../dAppConfig';

// MetaMask's MultiversX Snap logs in only with a signed login token: without
// one it cancels before MetaMask is asked (devnet, 5 Nov 2026). So every wallet
// is asked to sign one when connecting (sdk-dapp's native auth).

const SRC = resolve(process.cwd(), 'src');

/** The app's own source files, without the tests and the audit proofs. */
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return ['__audit__', 'tests'].includes(name) ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

describe('Signing in', () => {
  it('asks every wallet to sign a login token', () => {
    expect(dAppConfig.nativeAuth).toBe(true);
  });

  it('never hands that token to the network', () => {
    // The template's AxiosInterceptors put it on every request to the public
    // API as a bearer token. It proves the login to whoever holds it, and the
    // MultiversX API has no use for it.
    const handing = sources(SRC).filter((file) =>
      /setAxiosInterceptors|nativeAuthToken|bearerToken/.test(
        readFileSync(file, 'utf8')
      )
    );
    expect(handing.map((file) => file.slice(SRC.length + 1))).toEqual([]);
  });
});
