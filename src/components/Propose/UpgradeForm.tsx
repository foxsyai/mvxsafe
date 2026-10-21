import { useEffect, useMemo, useState } from 'react';
import { Info, Tip } from 'components/Info';
import { proposeUpgrade } from 'multisig/actions';
import { describeMetadata, MetadataFlags } from 'multisig/describe';
import { feeOf } from 'multisig/gas';
import {
  AccountFacts,
  expectedHashCheck,
  Inspection,
  inspectUpgrade,
  readAccountFacts
} from 'multisig/inspect';
import { parseAddress, upgradeProblem } from 'multisig/legacyCalls';
import { explainWalletFailure } from 'multisig/walletFailure';
import { FormProps } from './CallForm';
import { DeploySource } from './DeploySource';
import {
  ArgRow,
  ArgumentsEditor,
  CheckLine,
  encodeRows,
  field,
  Hash,
  hint,
  input,
  labelRow,
  primaryButton,
  StuckNote,
  useStuck
} from './shared';

// Replacing the code of a contract the safe owns with the code of a source
// contract. Everything a signer will be shown on the pending action is shown
// here first, by the same code (inspectUpgrade), and the proposal is refused
// while any of it is red: a source in another shard, a contract that would
// stop being upgradeable, a code hash that is not the release's.

const isContract = (value: string) => {
  try {
    return parseAddress(value).isSmartContract();
  } catch {
    return false;
  }
};

const FLAGS: { flag: keyof MetadataFlags; label: string; explain: string }[] = [
  {
    flag: 'upgradeable',
    label: 'Upgradeable',
    explain:
      'The board can replace its code again later. Without it, nobody ever can.'
  },
  {
    flag: 'readable',
    label: 'Readable',
    explain: 'Other contracts may read its storage.'
  },
  {
    flag: 'payable',
    label: 'Payable',
    explain: 'Accepts EGLD sent to it without calling a function.'
  },
  {
    flag: 'payableBySc',
    label: 'Payable by smart contracts',
    explain: 'Accepts EGLD from other contracts without calling a function.'
  }
];

const millions = (gas: bigint) =>
  `${(Number(gas) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;

export const UpgradeForm = ({
  safe,
  signer,
  disabled = false,
  disabledReason,
  onBusyChange,
  onProposed
}: FormProps) => {
  const [target, setTarget] = useState('');
  const [source, setSource] = useState('');
  const [expected, setExpected] = useState('');
  const [flags, setFlags] = useState<MetadataFlags | null>(null);
  const [flagsTouched, setFlagsTouched] = useState(false);
  const [rows, setRows] = useState<ArgRow[]>([]);
  const [targetFacts, setTargetFacts] = useState<AccountFacts | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [showDeploy, setShowDeploy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stuck = useStuck(busy);

  const targetText = target.trim();
  const sourceText = source.trim();
  const targetOk = isContract(targetText);
  const sourceOk = isContract(sourceText);
  const encoded = useMemo(() => encodeRows(rows), [rows]);

  // The contract's flags today are the starting point: an upgrade that keeps
  // them is the normal case, and any change is said in red.
  useEffect(() => {
    setTargetFacts(null);
    if (!targetOk) return;
    let live = true;
    readAccountFacts(targetText)
      .then((facts) => {
        if (!live) return;
        setTargetFacts(facts);
        if (!flagsTouched && facts.metadata) setFlags(facts.metadata);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [targetText, targetOk]);

  // The checks the signers will see, read again a moment after any change.
  useEffect(() => {
    setInspection(null);
    if (!targetOk || !sourceOk || !flags) return;
    let live = true;
    const timer = setTimeout(() => {
      inspectUpgrade([targetText, 0n, sourceText, flags], safe).then(
        (found) => live && setInspection(found)
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [targetText, sourceText, targetOk, sourceOk, flags, safe]);

  let problem = '';
  if (targetOk && sourceOk && flags) {
    try {
      problem = upgradeProblem({
        safe,
        target: targetText,
        source: sourceText,
        metadata: flags
      });
    } catch (failure) {
      problem = (failure as Error).message;
    }
  }

  const sourceHash = inspection?.upgrade?.sourceHash ?? null;
  const hashCheck = expectedHashCheck(expected, sourceHash);
  const blocking = (inspection?.checks ?? []).filter(
    (check) => check.tone === 'bad' && !check.advisory
  );
  const canPropose =
    Boolean(inspection && flags) &&
    !problem &&
    blocking.length === 0 &&
    hashCheck?.tone === 'ok' &&
    Object.keys(encoded.errors).length === 0;
  // The builder's refusal, said once: when no check already said it.
  const problemShown = problem && blocking.length === 0 ? problem : '';

  const plan = inspection?.perform;

  const submit = async () => {
    setError('');
    if (!canPropose || disabled || !flags) return;
    setBusy(true);
    onBusyChange?.(true);
    let reachedWallet = false;
    let sent = false;
    try {
      reachedWallet = true;
      await proposeUpgrade(signer, safe, {
        target: targetText,
        source: sourceText,
        metadata: flags,
        args: encoded.typed
      });
      sent = true;
      // Proposed: the same upgrade is not one press away from a duplicate
      // (web audit BRW-07).
      setTarget('');
      setSource('');
      setExpected('');
      setRows([]);
      setFlags(null);
      setFlagsTouched(false);
    } catch (failure) {
      setError(explainWalletFailure(failure, 'The proposal'));
    }
    setBusy(false);
    onBusyChange?.(false);
    if (reachedWallet) onProposed(sent);
  };

  const toggle = (flag: keyof MetadataFlags) => {
    if (!flags) return;
    setFlagsTouched(true);
    setFlags({ ...flags, [flag]: !flags[flag] });
  };

  return (
    <div>
      <div className={field}>
        <label className={labelRow}>
          Contract to upgrade
          <Info text='A contract this safe owns. Its address stays the same; only its code changes.' />
        </label>
        <input
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder='erd1qqqqqqqqqqqqqpgq...'
          className={`${input} font-mono`}
        />
        {targetText && !targetOk && (
          <p className='mt-1 text-xs text-[#F87171]'>
            That is not a contract address.
          </p>
        )}
        {targetFacts && (
          <p className='mt-2 text-xs text-[#6B7280]'>
            Shard {targetFacts.shard}. Code it runs today:{' '}
            <Hash value={targetFacts.codeHash} />
            {targetFacts.metadata && (
              <> It is {describeMetadata(targetFacts.metadata)}.</>
            )}
          </p>
        )}
      </div>

      <div className={field}>
        <label className={labelRow}>
          Source of the new code
          <Info text="A contract that already runs the new code, deployed in the safe's shard. The upgrade copies its code." />
        </label>
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder='erd1qqqqqqqqqqqqqpgq...'
          className={`${input} font-mono`}
        />
        {sourceText && !sourceOk && (
          <p className='mt-1 text-xs text-[#F87171]'>
            That is not a contract address.
          </p>
        )}
        {inspection?.upgrade && (
          <p className='mt-2 text-xs text-[#6B7280]'>
            Shard {inspection.upgrade.sourceShard}. Code it holds:{' '}
            <Hash value={sourceHash} />
          </p>
        )}
        <button
          type='button'
          onClick={() => setShowDeploy((open) => !open)}
          className='mt-2 text-xs text-[#FF6E0A] hover:underline'
        >
          {showDeploy
            ? 'Hide the source deploy'
            : 'No source yet? Deploy one from a .wasm file'}
        </button>
        {showDeploy && (
          <DeploySource
            safe={safe}
            signer={signer}
            disabled={disabled}
            onBusyChange={onBusyChange}
            onUse={(address) => {
              setSource(address);
              setShowDeploy(false);
            }}
          />
        )}
      </div>

      <div className={field}>
        <label className={labelRow}>
          Expected code hash of the source
          <Info text='The code hash published with the release, the same as for the file. It is compared with the code of the source contract on chain, the one the board will vote to copy: the proposal is only possible once they match.' />
        </label>
        <input
          value={expected}
          onChange={(event) => setExpected(event.target.value)}
          placeholder='64 hex characters from the release'
          className={`${input} font-mono`}
        />
        {hashCheck && <CheckLine check={hashCheck} />}
      </div>

      <div className={field}>
        <p className={labelRow}>
          Code metadata after the upgrade
          <Info text="What the contract allows once upgraded. It starts as the contract's flags today; anything changed is said in red." />
        </p>
        {!flags && <p className={hint}>Shown once the contract is read.</p>}
        {flags && (
          <div className='mt-1 grid gap-1 sm:grid-cols-2'>
            {FLAGS.map(({ flag, label, explain }) => {
              const changed =
                targetFacts?.metadata &&
                targetFacts.metadata[flag] !== flags[flag];
              return (
                <label
                  key={flag}
                  className='flex items-start gap-2 text-xs text-[#9AA0A6]'
                >
                  <input
                    type='checkbox'
                    checked={flags[flag]}
                    onChange={() => toggle(flag)}
                    className='mt-0.5 accent-[#FF6E0A]'
                  />
                  <span>
                    <span className={changed ? 'text-[#F87171]' : 'text-white'}>
                      {label}
                    </span>
                    {changed ? ' (changed)' : ''}. {explain}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className={field}>
        <p className={labelRow}>
          Arguments of its upgrade function
          <Info text='Most upgrades take none; mvxvest takes none.' />
        </p>
        <ArgumentsEditor
          rows={rows}
          onChange={setRows}
          errors={encoded.errors}
          free
        />
      </div>

      {inspection && (
        <div className='mt-4'>
          <p className='text-xs text-[#6B7280]'>
            What the signers will be shown:
          </p>
          {inspection.checks.map((check) => (
            <CheckLine key={check.text} check={check} />
          ))}
        </div>
      )}
      {problemShown && (
        <CheckLine check={{ tone: 'bad', text: problemShown }} />
      )}

      {plan && !plan.simulate && (
        <p className='mt-3 text-xs text-[#6B7280]'>
          Carrying it out will be given {millions(plan.gasLimit)} gas:{' '}
          {millions(plan.parts.safe)} for the safe, {millions(plan.parts.call)}{' '}
          for the upgrade, {millions(plan.parts.callback)} for the callback .
          About {(Number(feeOf(plan.gasLimit, 16)) / 1e18).toFixed(4)} EGLD,
          paid by whoever carries it out.
        </p>
      )}

      {error && <p className='mt-3 text-xs text-[#F87171]'>{error}</p>}
      <div className='mt-4'>
        <Tip text='Puts the upgrade in front of the board. Your wallet will ask you to sign this proposal, which costs a small network fee and changes nothing by itself.'>
          <button
            type='button'
            disabled={busy || disabled || !canPropose}
            onClick={submit}
            className={primaryButton}
          >
            {busy ? 'Waiting for your wallet...' : 'Propose'}
          </button>
        </Tip>
        {disabled && !busy && disabledReason && (
          <p className={hint}>{disabledReason}</p>
        )}
        {!disabled &&
          !canPropose &&
          inspection &&
          hashCheck?.tone !== 'ok' &&
          blocking.length === 0 &&
          !problem && (
            <p className={hint}>
              Paste the release&apos;s code hash to propose: it has to match the
              source.
            </p>
          )}
        {busy && stuck && (
          <StuckNote
            onStartOver={() => {
              setBusy(false);
              onBusyChange?.(false);
            }}
          />
        )}
      </div>
    </div>
  );
};
