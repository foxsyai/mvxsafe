import { useEffect, useRef, useState } from 'react';
import { Info, Tip } from 'components/Info';
import { deploySource, Signer } from 'multisig/actions';
import { feeOf, upgradeNeed, withMargin } from 'multisig/gas';
import { expectedHashCheck, readAccountFacts } from 'multisig/inspect';
import { codeHashOf, shardOf } from 'multisig/legacyCalls';
import { forget } from 'multisig/network';
import { explainWalletFailure } from 'multisig/walletFailure';
import {
  CheckLine,
  field,
  Hash,
  hint,
  input,
  labelRow,
  primaryButton,
  quietButton,
  StuckNote,
  useStuck
} from './shared';

// The source of an upgrade is a contract like any other, holding the new code.
// It has to live in the SAFE's shard, so it is deployed from a wallet in that
// shard, and it is not upgradeable, so nobody can swap its code while the
// board signs. Its code hash is computed here from the file, before anything
// is sent, and read back from the chain afterwards.

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

interface DeploySourceProps {
  safe: string;
  signer: Signer;
  /** Called with the source's address when its code is confirmed on chain. */
  onUse: (address: string) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

export const DeploySource = ({
  safe,
  signer,
  onUse,
  disabled = false,
  onBusyChange
}: DeploySourceProps) => {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileProblem, setFileProblem] = useState('');
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deployed, setDeployed] = useState('');
  const [onChainHash, setOnChainHash] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const stuck = useStuck(busy);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  const hash = bytes ? codeHashOf(bytes) : null;
  // What the deploy costs: its data carries the whole code as hex, paid in
  // full, then compiling it, at a hundredth (audit UPG-06, 14 Oct 2026; 26,540
  // bytes cost 0.0799 EGLD on devnet). Before a file is picked, mvxvest's size.
  const codeBytes = bytes?.length ?? 26540;
  const dataLength = 2 * codeBytes + '@0500@0400'.length;
  const deployFee = feeOf(
    withMargin(50000n + 1500n * BigInt(dataLength) + upgradeNeed(codeBytes)),
    dataLength
  );
  const deployCost = `about ${(Number(deployFee) / 1e18).toFixed(4)} EGLD ${bytes ? 'for this file' : 'for a 26 KB contract'}`;
  const hashCheck = hash ? expectedHashCheck(expected, hash) : null;
  const safeShard = shardOf(safe);
  const walletShard = signer.address ? shardOf(signer.address) : -1;
  const shardOk = walletShard === safeShard;
  const canDeploy =
    Boolean(bytes) &&
    shardOk &&
    hashCheck?.tone === 'ok' &&
    !busy &&
    !disabled &&
    !deployed;

  const pick = async (file: File | undefined) => {
    setFileProblem('');
    setBytes(null);
    setFileName(file?.name ?? '');
    if (!file) return;
    const read = new Uint8Array(await file.arrayBuffer());
    if (!WASM_MAGIC.every((byte, at) => read[at] === byte)) {
      setFileProblem(
        'That file is not WebAssembly: a contract starts with the bytes 00 61 73 6d.'
      );
      return;
    }
    setBytes(read);
  };

  // After the deploy: read the new address until its code is there, then
  // compare that code's hash with the file's.
  useEffect(() => {
    if (!deployed || onChainHash) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      forget(deployed);
      try {
        const facts = await readAccountFacts(deployed);
        if (facts.codeHash && alive.current) {
          setOnChainHash(facts.codeHash);
          clearInterval(timer);
        }
      } catch {
        // not there yet
      }
      if (attempts >= 40) {
        clearInterval(timer);
        if (alive.current) setGaveUp(true);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [deployed, onChainHash]);

  const deploy = async () => {
    if (!canDeploy || !bytes) return;
    setError('');
    setBusy(true);
    onBusyChange?.(true);
    try {
      setDeployed(await deploySource(signer, bytes));
    } catch (failure) {
      setError(explainWalletFailure(failure, 'The deploy'));
    }
    setBusy(false);
    onBusyChange?.(false);
  };

  return (
    <div className='mt-4 rounded-lg border border-[#2A2A32] bg-[#0E0E12] p-4'>
      <p className='flex items-center text-sm font-semibold text-white'>
        Deploy a source
        <Info text="A source is an ordinary contract holding the new code; the upgrade copies its code. It must be deployed in the safe's shard and is not upgradeable, so its code cannot change while the board signs." />
      </p>
      <p className={hint}>
        From a wallet in shard {safeShard}, the safe&apos;s shard. Not
        upgradeable, readable, not payable, no arguments.
      </p>

      <CheckLine
        check={
          shardOk
            ? {
                tone: 'ok',
                text: `Your wallet is in shard ${walletShard}, the safe's shard.`
              }
            : {
                tone: 'bad',
                text: `Your wallet is in shard ${walletShard}. A source deployed from it would live in shard ${walletShard}, where the upgrade cannot read it. Deploy it from a wallet in shard ${safeShard}.`
              }
        }
      />

      <div className={field}>
        <label className={labelRow}>The .wasm file of the release</label>
        <input
          type='file'
          accept='.wasm,application/wasm'
          onChange={(event) => pick(event.target.files?.[0])}
          className='mt-1 block w-full text-xs text-[#9AA0A6] file:mr-3 file:rounded-lg file:border file:border-[#2A2A32] file:bg-[#121218] file:px-3 file:py-1.5 file:text-xs file:text-[#9AA0A6]'
        />
        {fileProblem && (
          <p className='mt-1 text-xs text-[#F87171]'>{fileProblem}</p>
        )}
        {hash && (
          <p className='mt-2 text-xs text-[#6B7280]'>
            Code hash of {fileName} ({bytes?.length.toLocaleString('en-US')}{' '}
            bytes): <Hash value={hash} />
          </p>
        )}
      </div>

      {hash && (
        <div className={field}>
          <label className={labelRow}>
            Expected code hash
            <Info text='The code hash published with the release, for example in its codehash.txt. It has to match the file before the file can be deployed.' />
          </label>
          <input
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
            placeholder='64 hex characters from the release'
            className={`${input} font-mono`}
          />
          {hashCheck ? (
            <CheckLine check={hashCheck} />
          ) : (
            <p className={hint}>
              Paste it to deploy: the file is only sent once the two agree.
            </p>
          )}
        </div>
      )}

      {error && <p className='mt-3 text-xs text-[#F87171]'>{error}</p>}
      {!deployed && (
        <div className='mt-4'>
          <Tip
            text={`Your wallet signs one deploy. It costs ${deployCost} and touches nothing of the safe.`}
          >
            <button
              type='button'
              disabled={!canDeploy}
              onClick={deploy}
              className={primaryButton}
            >
              {busy ? 'Waiting for your wallet...' : 'Deploy the source'}
            </button>
          </Tip>
          {busy && stuck && (
            <StuckNote onStartOver={() => setBusy(false)} where='here' />
          )}
        </div>
      )}

      {deployed && (
        <div className='mt-4 text-xs text-[#9AA0A6]'>
          <p>
            Deployed to{' '}
            <span className='font-mono [overflow-wrap:anywhere] text-[#C9CDD2]'>
              {deployed}
            </span>
            .
          </p>
          {!onChainHash && !gaveUp && (
            <p className={hint}>Reading its code back from the chain...</p>
          )}
          {gaveUp && !onChainHash && (
            <CheckLine
              check={{
                tone: 'warn',
                text: 'Its code has not appeared after two minutes. Check the transaction in your wallet before using this address.'
              }}
            />
          )}
          {onChainHash && (
            <>
              <CheckLine
                check={
                  onChainHash === hash
                    ? {
                        tone: 'ok',
                        text: `The chain reports code hash ${onChainHash}, exactly the file's.`
                      }
                    : {
                        tone: 'bad',
                        text: `The chain reports code hash ${onChainHash}, NOT the file's ${hash}. Do not use it.`
                      }
                }
              />
              {onChainHash === hash && (
                <button
                  type='button'
                  onClick={() => onUse(deployed)}
                  className={`${quietButton} mt-3`}
                >
                  Propose the upgrade with this source
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
