import { useEffect, useMemo, useState } from 'react';
import { Info, Tip } from 'components/Info';
import { AbiEndpoint, readAbi } from 'multisig/abiForm';
import { proposeCall, Signer } from 'multisig/actions';
import { describeAction } from 'multisig/describe';
import {
  AccountFacts,
  callData,
  Check,
  readAccountFacts,
  trialAsSafe,
  trialCheck
} from 'multisig/inspect';
import {
  builtInRefusal,
  isSystemContract,
  normalizeBech32,
  parseAddress,
  toRawAmount
} from 'multisig/legacyCalls';
import { explainWalletFailure } from 'multisig/walletFailure';
import {
  ArgRow,
  ArgumentsEditor,
  CheckLine,
  encodeRows,
  field,
  hint,
  input,
  labelRow,
  primaryButton,
  rowsForSlots,
  StuckNote,
  useStuck
} from './shared';

// A call on a contract, usually one the safe owns: setFee, pauseCreation and
// the rest of an owner's endpoints. What the signers will read is shown here
// word for word, and the call is tried as the safe would send it, so a call
// the contract refuses is never put in front of the board.

const ENDPOINT = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;

const isContract = (value: string) => {
  try {
    return parseAddress(value).isSmartContract();
  } catch {
    return false;
  }
};

export interface FormProps {
  safe: string;
  signer: Signer;
  disabled?: boolean;
  disabledReason?: string;
  onBusyChange?: (busy: boolean) => void;
  onProposed: (sent: boolean) => void;
}

export const CallForm = ({
  safe,
  signer,
  disabled = false,
  disabledReason,
  onBusyChange,
  onProposed
}: FormProps) => {
  const [to, setTo] = useState('');
  const [abi, setAbi] = useState<{
    name: string;
    endpoints: AbiEndpoint[];
  } | null>(null);
  const [abiProblem, setAbiProblem] = useState('');
  const [functionName, setFunctionName] = useState('');
  const [egld, setEgld] = useState('');
  const [rows, setRows] = useState<ArgRow[]>([]);
  const [facts, setFacts] = useState<AccountFacts | null>(null);
  const [sentence, setSentence] = useState('');
  const [trial, setTrial] = useState<Check | null>(null);
  const [trying, setTrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stuck = useStuck(busy);

  const target = to.trim();
  const targetOk = isContract(target);
  const chosen = abi?.endpoints.find(
    (endpoint) => endpoint.name === functionName
  );
  const encoded = useMemo(() => encodeRows(rows), [rows]);

  let egldRaw: bigint | null = 0n;
  let egldProblem = '';
  try {
    egldRaw = toRawAmount(egld.trim() || '0', 18);
  } catch (failure) {
    egldRaw = null;
    egldProblem = (failure as Error).message;
  }
  if (egldRaw && chosen && !chosen.takesEgld) {
    egldProblem = `${chosen.name} does not accept EGLD, so the call would be refused.`;
  }

  const ready =
    targetOk &&
    ENDPOINT.test(functionName) &&
    Object.keys(encoded.errors).length === 0 &&
    egldRaw !== null &&
    !egldProblem;
  const data = ready
    ? callData(new TextEncoder().encode(functionName), encoded.bytes)
    : '';

  // Who the contract is, read as soon as the address is one.
  useEffect(() => {
    setFacts(null);
    if (!targetOk) return;
    let live = true;
    readAccountFacts(target)
      .then((read) => live && setFacts(read))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [target, targetOk]);

  // The sentence the signers will read, and the call tried as the safe, a
  // moment after the typing stops.
  useEffect(() => {
    setTrial(null);
    setSentence('');
    if (!ready || egldRaw === null) return;
    let live = true;
    const timer = setTimeout(async () => {
      const action = {
        name: 'SendAsyncCall',
        fields: [
          {
            to: target,
            egld_amount: egldRaw,
            endpoint_name: new TextEncoder().encode(functionName),
            arguments: encoded.bytes
          }
        ]
      };
      describeAction(action, safe).then((text) => live && setSentence(text));
      setTrying(true);
      const result = await trialAsSafe(safe, target, egldRaw as bigint, data);
      if (!live) return;
      setTrying(false);
      setTrial(trialCheck(result));
    }, 700);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [data, ready, target, egldRaw, safe, functionName, encoded.bytes]);

  const loadAbi = async (file: File | undefined) => {
    setAbiProblem('');
    if (!file) return;
    try {
      const read = readAbi(await file.text());
      setAbi(read);
      const first = read.endpoints[0];
      if (first) {
        setFunctionName(first.name);
        setRows(rowsForSlots(first.slots));
      }
    } catch (failure) {
      setAbi(null);
      setAbiProblem((failure as Error).message);
    }
  };

  const chooseEndpoint = (name: string) => {
    setFunctionName(name);
    const endpoint = abi?.endpoints.find(
      (candidate) => candidate.name === name
    );
    setRows(endpoint ? rowsForSlots(endpoint.slots) : []);
  };

  const noCode = facts !== null && !facts.codeHash;
  const notOwner = facts?.codeHash && facts.ownerAddress !== safe;
  // Nothing is proposed before it has been tried: not during the wait after
  // typing, not while the network answers (audit UPG-04, 14 Oct 2026).
  // A built-in of the network is not a contract's function: refused, with the
  // way to do it instead (audit UPG-01 and mvxvest's audit, 14 Oct 2026).
  const builtIn = builtInRefusal(functionName);
  const replacesCode = Boolean(builtIn);
  const blocked =
    trial === null || trying || trial.tone === 'bad' || noCode || replacesCode;

  const submit = async () => {
    setError('');
    if (!ready || blocked || disabled) return;
    setBusy(true);
    onBusyChange?.(true);
    let reachedWallet = false;
    let sent = false;
    try {
      reachedWallet = true;
      await proposeCall(signer, safe, {
        to: target,
        egld: egld.trim() || '0',
        functionName,
        args: encoded.typed
      });
      sent = true;
      // Proposed: the same call is not one press away from a duplicate
      // (web audit BRW-07). The contract and its ABI stay.
      setFunctionName('');
      setEgld('');
      setRows([]);
    } catch (failure) {
      setError(explainWalletFailure(failure, 'The proposal'));
    }
    setBusy(false);
    onBusyChange?.(false);
    if (reachedWallet) onProposed(sent);
  };

  const repeatSlot = chosen?.slots.find((slot) => slot.repeat);

  return (
    <div>
      <div className={field}>
        <label className={labelRow}>
          Contract
          <Info text='The contract to call, starting with erd1qqqqqqqqqqqqqpgq. The safe sends the call, so owner-only functions work on a contract the safe owns.' />
        </label>
        <input
          value={to}
          onChange={(event) => setTo(normalizeBech32(event.target.value))}
          placeholder='erd1qqqqqqqqqqqqqpgq...'
          className={`${input} font-mono`}
        />
        {target && !targetOk && (
          <p className='mt-1 text-xs text-[#F87171]'>
            That is not a contract address.
          </p>
        )}
        {targetOk && isSystemContract(target) && (
          <CheckLine
            check={{
              tone: 'bad',
              text: 'This is a system contract of the network (tokens, staking, governance). A call here can change who may mint, burn, freeze or own a token. It can also move stake. The signers will see it in red.'
            }}
          />
        )}
        {noCode && (
          <CheckLine
            check={{
              tone: 'bad',
              text: 'There is no contract at this address.'
            }}
          />
        )}
        {facts?.codeHash && (
          <CheckLine
            check={
              notOwner
                ? {
                    tone: 'warn',
                    text: `The safe does not own this contract; its owner is ${facts.ownerAddress || 'unknown'}. Owner-only functions will refuse it.`
                  }
                : { tone: 'ok', text: 'The safe owns this contract.' }
            }
          />
        )}
      </div>

      <div className={field}>
        <label className={labelRow}>
          Its ABI, if you have it
          <Info text="The contract's .abi.json, from its release. It fills in the functions and the type of every argument. It stays in this browser: the signers read the call from the chain, not from this file." />
        </label>
        <input
          type='file'
          accept='.json,application/json'
          onChange={(event) => loadAbi(event.target.files?.[0])}
          className='mt-1 block w-full text-xs text-[#9AA0A6] file:mr-3 file:rounded-lg file:border file:border-[#2A2A32] file:bg-[#0E0E12] file:px-3 file:py-1.5 file:text-xs file:text-[#9AA0A6]'
        />
        {abiProblem && (
          <p className='mt-1 text-xs text-[#F87171]'>{abiProblem}</p>
        )}
      </div>

      <div className={field}>
        <label className={labelRow}>
          Function
          <Info text='The name of the endpoint, exactly as the contract exports it, for example setFee.' />
        </label>
        {abi ? (
          <select
            value={functionName}
            onChange={(event) => chooseEndpoint(event.target.value)}
            className={input}
          >
            {abi.endpoints.map((endpoint) => (
              <option key={endpoint.name} value={endpoint.name}>
                {endpoint.name}
                {endpoint.onlyOwner ? ' (owner only)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={functionName}
            onChange={(event) => setFunctionName(event.target.value.trim())}
            placeholder='setFee'
            className={`${input} font-mono`}
          />
        )}
        {functionName && !ENDPOINT.test(functionName) && (
          <p className='mt-1 text-xs text-[#F87171]'>
            That is not a function name a contract can have.
          </p>
        )}
        {builtIn && <p className='mt-1 text-xs text-[#F87171]'>{builtIn}</p>}
        {chosen?.docs && <p className={hint}>{chosen.docs}</p>}
      </div>

      <div className={field}>
        <label className={labelRow}>
          Arguments
          <Info text='Each one is written the way the contract reads it. An EGLD amount is typed like 0.01; a whole number is in base units.' />
        </label>
        <ArgumentsEditor
          rows={rows}
          onChange={setRows}
          errors={encoded.errors}
          free={!abi}
          repeatSlot={repeatSlot}
        />
      </div>

      <div className={field}>
        <label className={labelRow}>
          EGLD paid with the call, not an argument
          <Info text='A payment that goes with the call, usually nothing. Only for functions that ask to be paid, such as issuing a token. A fee or an amount the function takes as a value is an argument: add it under Arguments.' />
        </label>
        <input
          value={egld}
          onChange={(event) => setEgld(event.target.value)}
          placeholder='0'
          className={input}
        />
        {egldProblem && (
          <p className='mt-1 text-xs text-[#F87171]'>{egldProblem}</p>
        )}
      </div>

      {sentence && (
        <div className='mt-4 rounded-lg border border-[#2A2A32] bg-[#0E0E12] p-3 text-xs'>
          <p className='text-[#6B7280]'>The signers will read:</p>
          <p className='mt-1 text-sm text-white [overflow-wrap:anywhere]'>
            {sentence}
          </p>
          <p className='mt-2 text-[#6B7280]'>
            Sent as{' '}
            <span className='font-mono text-[#9AA0A6] [overflow-wrap:anywhere]'>
              {data}
            </span>
          </p>
        </div>
      )}
      {trying && <p className={hint}>Trying it as the safe would send it...</p>}
      {trial && <CheckLine check={trial} />}

      {error && <p className='mt-3 text-xs text-[#F87171]'>{error}</p>}
      <div className='mt-4'>
        <Tip text='Puts the call in front of the board. Your wallet will ask you to sign this proposal, which costs a small network fee and calls nothing by itself.'>
          <button
            type='button'
            disabled={busy || disabled || !ready || blocked}
            onClick={submit}
            className={primaryButton}
          >
            {busy ? 'Waiting for your wallet...' : 'Propose'}
          </button>
        </Tip>
        {disabled && !busy && disabledReason && (
          <p className={hint}>{disabledReason}</p>
        )}
        {!disabled && trial?.tone === 'bad' && (
          <p className={hint}>
            Refused here because the contract refuses it: the board would sign a
            call that fails.
          </p>
        )}
        {/* Found in the first mainnet vote (14 Oct 2026): setFee 0 typed into
            the payment field, and no argument. */}
        {!disabled &&
          trial &&
          /wrong number of arguments/i.test(trial.text) && (
            <p className={hint}>
              {functionName} expects{' '}
              {rows.length ? 'other arguments than these' : 'arguments'}: add
              them under Arguments. EGLD paid with the call is a payment, not an
              argument.
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
