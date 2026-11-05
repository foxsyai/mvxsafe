import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { AddressLine } from 'components/Address';
import { Info, Tip } from 'components/Info';
import { ActionChecks, performGas } from 'components/Pending/ActionChecks';
import { ProposePanel } from 'components/Propose';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import {
  discardAction,
  handOverSafe,
  performAction,
  signAction,
  unsignAction
} from 'multisig/actions';
import type { Inspection } from 'multisig/inspect';
import {
  actionIdInData,
  MULTISIG_CODE_HASH,
  normalizeBech32,
  normalizeCodeHash
} from 'multisig/legacyCalls';
import { clearCache, explorerUrl, forget } from 'multisig/network';
import {
  ContractInfo,
  featuredToken,
  formatUsd,
  HistoryEntry,
  IDENTITY_LINE,
  identityOf,
  PENDING_PAGE,
  PendingAction,
  PendingCoverage,
  PendingList,
  readActionByNumber,
  readCardChecks,
  readContractInfo,
  readHistory,
  readOverview,
  readPendingActions,
  readUserRole,
  SafeIdentity,
  SafeOverview,
  signedFirst,
  tokensNotReadLine
} from 'multisig/reads';
import { isValidSafeAddress, nameFor } from 'multisig/savedSafes';
import { explainWalletFailure } from 'multisig/walletFailure';

const card = 'rounded-xl border border-[#2A2A32] bg-[#121218] p-5';
const pendingCard =
  'rounded-xl border-2 border-[#FF6E0A] bg-[#FF6E0A]/[0.06] p-5';
const label = 'text-xs text-[#6B7280]';
const grouped = (count: number) => count.toLocaleString('en-US');
const HOLDINGS_ROWS = 20;

/**
 * The route. It refuses anything that is not an address before touching the
 * network (/safe/__proto__ used to unmount the whole app, web audit WEB-03),
 * and gives every safe its own instance of the page: kept as one instance, a
 * Treasury -> Team change showed Treasury's actions under Team's title, and
 * Sign then sent Treasury's action id to the Team safe (WEB-01). The key
 * throws away the old state, its pending reads and its timers.
 */
export const Safe = () => {
  const { address = '' } = useParams();
  // The same safe written in capitals, which bech32 allows: one page, one
  // address (backlog of the 21 Oct audit).
  const lower = normalizeBech32(address);
  if (lower !== address && isValidSafeAddress(lower)) {
    return <Navigate to={`/safe/${lower}`} replace />;
  }
  if (!isValidSafeAddress(address)) {
    return (
      <div className='mx-auto w-full max-w-5xl px-4 py-10'>
        <Link to='/' className='text-sm text-[#9AA0A6] hover:text-[#FF6E0A]'>
          &larr; All safes
        </Link>
        <p className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          That is not a MultiversX address, so there is no safe to show.
        </p>
      </div>
    );
  }
  return <SafeView key={address} address={address} />;
};

const SafeView = ({ address }: { address: string }) => {
  const [overview, setOverview] = useState<SafeOverview | null>(null);
  // Null when the pending actions could not be read, which is NOT the same as none.
  const [pending, setPending] = useState<PendingAction[] | null>([]);
  // How far that list reaches, and what the cards' own checks found.
  const [coverage, setCoverage] = useState<PendingCoverage | null>(null);
  const [cardChecks, setCardChecks] = useState<Record<number, Inspection>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [allTokens, setAllTokens] = useState(false);
  // One action asked for by its number, whatever the list has reached.
  const [goText, setGoText] = useState('');
  const [wanted, setWanted] = useState<PendingAction | null>(null);
  const [wantedNote, setWantedNote] = useState('');
  const [wantedReading, setWantedReading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // False until the history was read once: before that, "none" would be a guess.
  const [historyRead, setHistoryRead] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Null while unknown: nobody is told they are not on a board before it was checked.
  const [role, setRole] = useState<string | null>(null);
  const [working, setWorking] = useState(0);
  const [stuck, setStuck] = useState(false);
  const [problem, setProblem] = useState('');
  const [contract, setContract] = useState<ContractInfo | null>(null);
  // True when the last read of the contract's own account failed.
  const [codeFailed, setCodeFailed] = useState(false);
  const [codeChecking, setCodeChecking] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  // True while the propose form waits for the wallet.
  const [proposing, setProposing] = useState(false);
  // True when the last read was refused and the page shows the one before.
  const [stale, setStale] = useState(false);
  // True between a successful send and the read that shows its result.
  const [awaiting, setAwaiting] = useState(false);
  // What a performer typed as the gas of an action the network cannot simulate.
  const [gasText, setGasText] = useState<Record<number, string>>({});

  // Set by the create page: the deploy was just sent, so for a little while an
  // address that cannot be read yet is expected, not a failure.
  const created = useLocation().state as {
    creating?: boolean;
    handOverRefused?: boolean;
  } | null;
  const creating = Boolean(created?.creating);
  // The deploy was sent but the handover was not (TXN-02).
  const handOverRefused = Boolean(created?.handOverRefused);
  const [waitedFor, setWaitedFor] = useState(0);

  const isLoggedIn = useGetIsLoggedIn();
  const account = useGetAccount();
  const signer = {
    address: account.address,
    nonce: Number(account.nonce ?? 0)
  };
  // A wallet prompt is open: an action, a proposal or the handover. Nothing
  // else may start meanwhile, or two transactions are built on one nonce
  // (WEB-08; the handover was outside it, web audit BRW-02).
  const walletOpen = working !== 0 || proposing || handingOver;
  // Which prompt is the newest. "start over" gives up on the open one, and an
  // abandoned prompt that settles later must not release the one opened after
  // it (web audit BRW-08, 21 Oct 2026).
  const promptRef = useRef(0);
  const canPropose = role === 'BoardMember' || role === 'Proposer';
  const canSign = role === 'BoardMember';

  // False once this view is gone: a read that finishes later changes nothing.
  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);

  // Each part is read on its own, and a part the network refused keeps what
  // was read before: a failed refresh used to replace a safe with "unknown",
  // "No board members found" and "not on this board" (7 Oct 2026). Only a
  // first read that fails is shown as a failure. Only the safe's own state,
  // its board, quorum and pending actions, can leave the page stale, and while
  // it is stale nothing can be signed and the page retries by itself.
  const readBefore = useRef({ overview: false, pending: false });
  const staleRetries = useRef(0);
  const loadRef = useRef<() => Promise<boolean>>(async () => false);
  // Every load has a number, and only the newest one writes. A wallet change
  // or a Refresh starts a new load without stopping the old one, whose role
  // read, answering last, used to become the NEW wallet's role: a stranger was
  // told "a board member here" and shown Sign (web audit BRW-01, 21 Oct 2026).
  const generation = useRef(0);

  // The code behind this address, read on its own, one request. Nothing can be
  // signed until there is an answer, so a read that failed, or an answer with
  // no hash, is asked again by itself: 5 s, 10 s, then every 30 s. A hash read
  // once stays: a contract does not lose its code, and a moment of a flaky API
  // must not take the buttons from a safe already known.
  const codeRound = useRef(0);
  const codeRetries = useRef(0);
  const hashRead = useRef(false);
  const checkCode = useCallback(
    async function again(): Promise<void> {
      const mine = ++codeRound.current;
      const current = () => alive.current && codeRound.current === mine;
      setCodeChecking(true);
      try {
        const info = await readContractInfo(address);
        if (!current()) return;
        setCodeFailed(false);
        if (info.exists) hashRead.current = true;
        if (info.exists || !hashRead.current) setContract(info);
      } catch {
        if (!current()) return;
        setCodeFailed(true);
      }
      setCodeChecking(false);
      if (hashRead.current) {
        codeRetries.current = 0;
        return;
      }
      const delay = Math.min(30000, 5000 * Math.pow(2, codeRetries.current++));
      timers.current.push(
        setTimeout(() => {
          if (!current()) return;
          forget(address);
          again();
        }, delay)
      );
    },
    [address]
  );

  // The checks of the cards on the page, once each per load, filling in behind
  // the sentences. A flood must not pay for them before anyone sees a card, and
  // until they have arrived a card cannot be signed (FND-02, RED-03, 1 Nov 2026).
  const checksAsked = useRef(new Map<number, Promise<void>>());
  const askChecks = useCallback(
    (list: PendingAction[], current: () => boolean) =>
      Promise.all(
        list
          .filter((action) => action.checksDue)
          .map((action) => {
            let asked = checksAsked.current.get(action.actionId);
            if (!asked) {
              asked = readCardChecks(address, action).then((found) => {
                if (!current()) return;
                setCardChecks((known) => ({
                  ...known,
                  [action.actionId]: found
                }));
              });
              checksAsked.current.set(action.actionId, asked);
            }
            return asked;
          })
      ),
    [address]
  );

  // The list on the page: a Refresh brings as many cards back.
  const shown = useRef<PendingList>([]);
  const showList = useCallback((list: PendingList) => {
    shown.current = list;
    setPending(list);
    setCoverage(list.coverage ?? null);
  }, []);

  // The number asked for, read again with every load: it can be gone by then.
  const wantedId = useRef<number | null>(null);
  const readWanted = useCallback(
    async (id: number, current: () => boolean) => {
      const found = await readActionByNumber(address, id, {
        known: shown.current,
        olderUnread: shown.current.coverage?.olderUnread ?? 0
      });
      if (!current() || wantedId.current !== id) return;
      if (found.status === 'card') {
        setWanted(found.card);
        setWantedNote('');
        await askChecks([found.card], current);
        return;
      }
      wantedId.current = null;
      setWanted(null);
      setWantedNote(
        found.status === 'finished'
          ? `Action #${id} was carried out or discarded: the contract keeps nothing under that number, so nothing is waiting there.`
          : `Action #${id} does not exist yet: the last one proposed is #${found.last}.`
      );
    },
    [address, askChecks]
  );

  const load = useCallback(async (): Promise<boolean> => {
    if (!alive.current) return false;
    const mine = ++generation.current;
    const current = () => alive.current && generation.current === mine;
    setLoading(true);
    let fresh = true;
    const codeChecked = checkCode();
    checksAsked.current = new Map();
    // Side by side: the first card must not wait for the rest of the page, nor
    // the role and with it the buttons for the last card.
    const overviewRead = (async () => {
      try {
        const next = await readOverview(address);
        if (current()) {
          setOverview(next);
          readBefore.current.overview = true;
          setFailed(false);
        }
      } catch {
        fresh = false;
        if (current() && !readBefore.current.overview) setFailed(true);
      }
    })();
    const pendingRead = (async () => {
      try {
        const next = await readPendingActions(address, {
          limit: Math.max(PENDING_PAGE, shown.current.length),
          // A card as soon as its sentence is known. On a later read the page
          // keeps the list it has until the new one is whole.
          onProgress: (list) => {
            if (!current() || readBefore.current.pending) return;
            showList(list);
            askChecks(list, current);
          }
        });
        if (current()) {
          showList(next);
          readBefore.current.pending = true;
          if (next.coverage?.interrupted) fresh = false;
          await askChecks(next, current);
        }
      } catch {
        fresh = false;
        if (current() && !readBefore.current.pending) setPending(null);
      }
    })();
    // History and role keep their last value when refused, without blocking.
    readHistory(address)
      .then((entries) => {
        if (!current()) return;
        setHistory(entries);
        setHistoryRead(true);
      })
      .catch(() => undefined);
    const roleRead = (async () => {
      try {
        const next = isLoggedIn
          ? await readUserRole(address, account.address)
          : 'None';
        if (current()) setRole(next);
      } catch {
        // Unknown stays unknown: never "not on this board" for a refused read.
      }
    })();
    const wantedRead = (async () => {
      await pendingRead;
      if (wantedId.current === null) return;
      try {
        await readWanted(wantedId.current, current);
      } catch {
        fresh = false;
      }
    })();
    await Promise.all([overviewRead, wantedRead, roleRead, codeChecked]);
    // A newer load is under way and decides what the page shows. Not "fresh":
    // what this one read is not on the page, and the processed signal would
    // release the buttons over the state from before the transaction (third
    // review of PR #11).
    if (!current()) return false;
    const isStale =
      !fresh && (readBefore.current.overview || readBefore.current.pending);
    setStale(isStale);
    setLoading(false);
    // Whatever was refused, first read or later, is asked again by itself.
    if (!fresh) {
      // 5 s, 10 s, then every 30 s, until the network answers.
      const delay = Math.min(30000, 5000 * Math.pow(2, staleRetries.current++));
      timers.current.push(
        setTimeout(() => {
          forget(address);
          loadRef.current();
        }, delay)
      );
    } else if (fresh) {
      staleRetries.current = 0;
    }
    return fresh;
  }, [
    address,
    isLoggedIn,
    account.address,
    checkCode,
    askChecks,
    showList,
    readWanted
  ]);
  loadRef.current = load;

  // Older actions, on request. What is on the page stays whatever this finds.
  const loadMore = async () => {
    if (!coverage || !pending || loadingMore) return;
    const mine = generation.current;
    const current = () => alive.current && generation.current === mine;
    setLoadingMore(true);
    setMoreFailed(false);
    const show = (list: PendingList) => {
      if (!current()) return;
      showList(list);
      askChecks(list, current);
    };
    try {
      const next = await readPendingActions(address, {
        before: coverage.nextBefore,
        known: pending,
        onProgress: show
      });
      show(next);
      if (current() && next.coverage?.interrupted) setMoreFailed(true);
    } catch {
      if (current()) setMoreFailed(true);
    }
    setLoadingMore(false);
  };

  const goToAction = async (event: FormEvent) => {
    event.preventDefault();
    const text = goText.trim().replace(/^#\s*/, '');
    const id = /^\d+$/.test(text) ? Number(text) : 0;
    setWanted(null);
    if (id < 1 || !Number.isSafeInteger(id)) {
      wantedId.current = null;
      setWantedNote('An action number is a whole number, from 1.');
      return;
    }
    wantedId.current = id;
    setWantedNote('');
    setWantedReading(true);
    const mine = generation.current;
    try {
      await readWanted(id, () => alive.current && generation.current === mine);
    } catch {
      if (alive.current && wantedId.current === id) {
        setWantedNote(
          `The network did not answer for action #${id} just now, so nothing can be said about it. Try again.`
        );
      }
    }
    if (alive.current) setWantedReading(false);
  };

  const closeWanted = () => {
    wantedId.current = null;
    setWanted(null);
    setWantedNote('');
  };

  // A check that failed stays on its card until it has been run again.
  const checkCardAgain = async (action: PendingAction) => {
    forget(address);
    const found = await readCardChecks(address, action);
    if (alive.current) {
      setCardChecks((known) => ({ ...known, [action.actionId]: found }));
    }
  };

  // A different safe or a different wallet: what was known about the role no
  // longer applies until it has been read again.
  useEffect(() => {
    setRole(null);
  }, [address, isLoggedIn, account.address]);

  // Every one of these ends in the visitor's wallet asking them to confirm.
  // Whatever goes wrong is shown: this used to swallow failures, so a signed
  // transaction that the node refused looked exactly like nothing happening.
  const run = async (actionId: number, work: () => Promise<unknown>) => {
    // One wallet prompt at a time: every action button is disabled while this
    // runs, or a second transaction could be built on the same nonce (WEB-08).
    if (walletOpen || awaiting) return;
    const mine = ++promptRef.current;
    setWorking(actionId);
    setProblem('');
    let sent = false;
    try {
      await work();
      sent = true;
    } catch (failure: unknown) {
      setProblem(explainWalletFailure(failure, 'That'));
    }
    if (promptRef.current === mine) setWorking(0);
    if (sent) {
      // Sent: the network needs a few seconds. The buttons wait for the
      // processed signal, so the same action is not sent twice meanwhile.
      awaitNetwork();
    } else {
      // A send whose answer was lost may have gone through, and only the
      // chain can say (WEB-07).
      forget(address);
      await load();
    }
  };

  // A wallet that never answers, an xPortal request dismissed on the phone for
  // example, would leave the buttons disabled until the page is reloaded. The
  // handover too: it holds every button since BRW-02 (review of PR #11).
  const prompting = working !== 0 || handingOver;
  useEffect(() => {
    if (!prompting) {
      setStuck(false);
      return;
    }
    const timer = setTimeout(() => setStuck(true), 25000);
    return () => clearTimeout(timer);
  }, [prompting]);

  useEffect(() => {
    load();
  }, [load]);

  // A safe that was just created takes a few seconds to exist. Keep reading for
  // up to two minutes instead of declaring it unreadable.
  useEffect(() => {
    if (!creating || !failed || waitedFor >= 40) return;
    const timer = setTimeout(() => {
      setWaitedFor((count) => count + 1);
      forget(address);
      load();
    }, 3000);
    return () => clearTimeout(timer);
  }, [creating, failed, waitedFor, load]);

  const ownsItself = !contract?.exists || contract.ownerAddress === address;
  const youOwnIt = isLoggedIn && contract?.ownerAddress === account.address;
  // Every sentence on this page is decoded for one code. From any other it is
  // the contract's own word, so there is no override (SGN-01, RED-01).
  const identity: SafeIdentity | null = contract
    ? identityOf(contract.codeHash)
    : codeFailed
      ? 'unverified'
      : null;
  const held = identity !== 'known';

  // The same rules as run: one prompt at a time, and "Sent" only when it was.
  const handOver = async () => {
    if (walletOpen || awaiting) return;
    const mine = ++promptRef.current;
    setHandingOver(true);
    setProblem('');
    let sent = false;
    try {
      await handOverSafe(signer, address);
      sent = true;
    } catch (failure: unknown) {
      setProblem(explainWalletFailure(failure, 'The handover'));
    }
    if (promptRef.current === mine) setHandingOver(false);
    if (sent) {
      awaitNetwork();
    } else {
      forget(address);
      await load();
    }
  };

  // A transaction sent from this page lands seconds after the wallet returns, so
  // the page reads everything again at that moment rather than waiting for the
  // visitor to press Refresh.
  useEffect(() => {
    const again = (event: Event) => {
      const touched: string[] | undefined = (event as CustomEvent).detail
        ?.addresses;
      if (touched && !touched.includes(address)) return;
      forget(address);
      load().then((fresh) => {
        if (fresh && alive.current) setAwaiting(false);
      });
    };
    window.addEventListener('mvxsafe:settled', again);
    return () => window.removeEventListener('mvxsafe:settled', again);
  }, [load]);

  // The processed signal above comes from the SDK, and on a clock from
  // signAndSendTransactions. Should neither arrive, the buttons are released
  // after half a minute with one last read.
  const awaitNetwork = useCallback(() => {
    setAwaiting(true);
    timers.current.push(
      setTimeout(() => {
        if (!alive.current) return;
        setAwaiting(false);
        forget(address);
        load();
      }, 30000)
    );
  }, [address, load]);

  const title = nameFor(address) || 'Safe';
  const tokens = overview?.tokens ?? [];
  const primary = featuredToken(tokens);
  const others = tokens.filter((token) => token !== primary);
  // Junk can run to hundreds of rows: the most valuable lead, the rest on request.
  const holdings = [primary, ...others].filter(Boolean) as typeof tokens;
  const holdingsShown = allTokens ? holdings : holdings.slice(0, HOLDINGS_ROWS);
  // Newest first: what a flood buries is the old, and the board's answer to it,
  // removing the rogue, is always the newest. And when the contract returns the
  // whole list, what carries a signature leads, which a proposer's junk cannot.
  const cards = [...(pending ?? [])].sort(
    coverage && !coverage.oneByOne
      ? signedFirst
      : (a, b) => b.actionId - a.actionId
  );
  const olderUnread = coverage?.olderUnread ?? 0;
  const olderKnown = coverage?.olderKnown ?? 0;
  const pendingCount =
    coverage?.pendingCount ??
    (coverage && olderUnread > 0 && cards.length > 0
      ? `${grouped(cards.length)}+`
      : coverage
        ? '?'
        : overview?.pendingCount);

  const renderCard = (listed: PendingAction) => {
    // The sentence is on the card before its checks. Until they have
    // arrived, or when they could not be run, it is neither signed
    // nor carried out: they may hold the very line that says not to
    // (FND-02, RED-03, 1 Nov 2026).
    const answer = cardChecks[listed.actionId];
    const action: PendingAction = answer
      ? {
          ...listed,
          checks: [...answer.checks, ...(listed.checks ?? [])],
          upgrade: answer.upgrade,
          perform: answer.perform
        }
      : listed;
    const checksWaiting = Boolean(listed.checksDue && !answer);
    const checksFailed = Boolean(answer?.failed);
    const gas = performGas(action.perform, gasText[action.actionId]);
    // An upgrade whose code the API did not return: its hash would be
    // the API's word and its gas unknown, so it is neither signed nor
    // carried out on that answer (EXT-01, found 23 Oct 2026).
    const codeUnread = Boolean(
      action.upgrade?.sourceUnread || action.upgrade?.targetUnread
    );
    // Nor one whose source has no upgrade function: it fails after the
    // signatures and uses the action up. Discard stays, to clear it
    // (FND-04, 1 Nov 2026).
    const cannotUpgrade = Boolean(action.upgrade?.noUpgradeFunction);
    return (
      // Orange, unlike every other card: something is waiting here.
      <div key={action.actionId} className={pendingCard}>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          {/* Full addresses and identifiers make this long; it wraps
                      anywhere rather than hiding the part that matters. */}
          <p className='min-w-0 flex-1 text-white [overflow-wrap:anywhere]'>
            <span className='mr-2 font-mono text-xs text-[#6B7280]'>
              #{action.actionId}
            </span>
            {/* The number as a wallet shows it in the data, in hex: #10 is
                sign@0a. MetaMask's Snap shows nothing else to match. */}
            <Tip
              text={`Your wallet shows this action as @${actionIdInData(action.actionId)} at the end of its data, for example sign@${actionIdInData(action.actionId)}: the number in hex.`}
            >
              <span className='mr-2 font-mono text-xs text-[#6B7280]'>
                @{actionIdInData(action.actionId)}
              </span>
            </Tip>
            {action.description}
          </p>
          <span
            className={
              action.quorumReached
                ? 'rounded-full bg-[#FF6E0A]/15 px-3 py-1 text-xs text-[#FF6E0A]'
                : 'rounded-full bg-[#2A2A32] px-3 py-1 text-xs text-[#9AA0A6]'
            }
          >
            {action.signerCount} of {overview?.quorum ?? '?'} signatures
          </span>
        </div>
        {action.signers.length > 0 && (
          <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6B7280]'>
            <span>signed by</span>
            {action.signers.map((who) => (
              <AddressLine
                key={who}
                address={who}
                className='text-xs text-[#6B7280]'
              />
            ))}
          </div>
        )}
        {action.formerSigners.length > 0 && (
          <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6B7280]'>
            <span>also signed, but has left the board and does not count:</span>
            {action.formerSigners.map((who) => (
              <AddressLine
                key={who}
                address={who}
                className='text-xs text-[#6B7280] line-through'
              />
            ))}
          </div>
        )}

        {checksWaiting && (
          <p className='mt-2 text-xs text-[#6B7280]'>
            Checking this action on chain. Sign and Carry it out wait for the
            result.
          </p>
        )}

        <ActionChecks
          action={action}
          showGas={
            // Whoever may carry it out, proposers included: the
            // contract lets them (backlog of the 21 Oct audit).
            isLoggedIn && (canSign || canPropose) && action.quorumReached
          }
          gasText={gasText[action.actionId]}
          onGasText={(text) =>
            setGasText((current) => ({
              ...current,
              [action.actionId]: text
            }))
          }
        />

        {checksFailed && (
          <button
            type='button'
            onClick={() => checkCardAgain(listed)}
            className='mt-2 text-xs font-semibold text-[#F87171] underline'
          >
            Check again
          </button>
        )}

        {isLoggedIn && (canSign || canPropose) && (
          <div className='mt-3 flex flex-wrap items-center gap-2'>
            {canSign &&
              (action.signers.includes(account.address) ? (
                <Tip text='Takes your approval back. Possible for as long as the action is still waiting.'>
                  <button
                    type='button'
                    disabled={walletOpen || stale || awaiting || held}
                    onClick={() =>
                      run(action.actionId, () =>
                        unsignAction(signer, address, action.actionId)
                      )
                    }
                    className='rounded-lg border border-[#2A2A32] px-3 py-1.5 text-xs text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white disabled:opacity-50'
                  >
                    Remove my signature
                  </button>
                </Tip>
              ) : action.unreadable ? null : (
                // An action the contract cannot return is never signed (SC-01).
                <Tip text='Approves this action. It still needs the rest of the quorum before anything happens.'>
                  <button
                    type='button'
                    disabled={
                      walletOpen ||
                      stale ||
                      awaiting ||
                      codeUnread ||
                      cannotUpgrade ||
                      checksWaiting ||
                      checksFailed ||
                      held
                    }
                    onClick={() =>
                      run(action.actionId, () =>
                        signAction(signer, address, action.actionId)
                      )
                    }
                    className='rounded-lg bg-[#FF6E0A] px-4 py-1.5 text-xs font-semibold text-black hover:bg-[#ff8534] disabled:opacity-50'
                  >
                    Sign
                  </button>
                </Tip>
              ))}

            {action.quorumReached && !action.unreadable && (
              <Tip text='Makes it happen. Enough signatures are in. Any board member or proposer may press this.'>
                <button
                  type='button'
                  disabled={
                    walletOpen ||
                    stale ||
                    awaiting ||
                    codeUnread ||
                    cannotUpgrade ||
                    checksWaiting ||
                    checksFailed ||
                    held ||
                    Boolean(gas.problem)
                  }
                  onClick={() =>
                    run(action.actionId, () =>
                      performAction(
                        signer,
                        address,
                        action.actionId,
                        gas.budget
                      )
                    )
                  }
                  className='rounded-lg bg-[#F5F5F5] px-4 py-1.5 text-xs font-semibold text-black hover:bg-white disabled:opacity-50'
                >
                  Carry it out
                </button>
              </Tip>
            )}

            <Tip
              text={
                action.signerCount > 0
                  ? 'Cannot be discarded while it carries signatures. The contract refuses it. Everyone who signed has to remove their signature first.'
                  : 'Throws the action away without doing it. Nothing moves and nothing is spent.'
              }
            >
              <button
                type='button'
                disabled={
                  walletOpen ||
                  stale ||
                  awaiting ||
                  held ||
                  action.signerCount > 0
                }
                onClick={() =>
                  run(action.actionId, () =>
                    discardAction(signer, address, action.actionId)
                  )
                }
                className='rounded-lg border border-[#2A2A32] px-3 py-1.5 text-xs text-[#6B7280] hover:border-[#F87171] hover:text-[#F87171] disabled:opacity-50'
              >
                Discard
              </button>
            </Tip>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className='mx-auto w-full max-w-5xl px-4 py-10'>
      <Link to='/' className='text-sm text-[#9AA0A6] hover:text-[#FF6E0A]'>
        &larr; All safes
      </Link>

      <div className='mt-4 flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h1 className='text-3xl font-semibold text-white'>{title}</h1>
          <AddressLine
            address={address}
            short={false}
            className='mt-2 text-xs text-[#6B7280]'
          />
          {isLoggedIn && (
            <p className='mt-2 text-xs text-[#6B7280]'>
              You are{' '}
              <span className='text-[#9AA0A6]'>
                {role === null
                  ? 'being checked against this board'
                  : role === 'BoardMember'
                    ? identity === 'other' || identity === 'unverified'
                      ? "a board member here by this contract's own word, and nothing can be signed"
                      : 'a board member here: you can propose, sign and carry out actions'
                    : role === 'Proposer'
                      ? identity === 'other' || identity === 'unverified'
                        ? "a proposer here by this contract's own word, and nothing can be proposed"
                        : 'a proposer here: you can propose, but not sign'
                      : 'not on this board, so you can only look'}
              </span>
              .
            </p>
          )}
          {identity === 'known' &&
            ownsItself &&
            contract?.upgradeable === true && (
              <p className='mt-2 text-xs text-[#6B7280]'>
                Upgradeable: its board can replace it by a vote.
              </p>
            )}
          {identity === 'known' &&
            ownsItself &&
            contract?.upgradeable === false && (
              <p className='mt-2 text-xs text-[#6B7280]'>
                Fixed for good: nobody can replace it, its board included.
              </p>
            )}
        </div>
        <Tip text='Reads everything from the chain again, ignoring what was remembered.'>
          <button
            type='button'
            onClick={() => {
              clearCache();
              load();
            }}
            className='rounded-lg border border-[#2A2A32] px-4 py-2 text-sm text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white'
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </Tip>
      </div>

      {failed &&
        (creating && waitedFor < 40 ? (
          <p className='mt-6 rounded-lg border border-[#2A2A32] bg-[#121218] p-4 text-sm text-[#9AA0A6]'>
            {handOverRefused
              ? "Being created. The transaction that makes the safe its own owner was not sent, so until it is, the safe is in your wallet's hands. As soon as the safe exists, this page offers to hand it to itself."
              : 'Being created. The network needs a few seconds to run the two transactions; this page fills in by itself as soon as the safe exists.'}
          </p>
        ) : (
          <p className='mt-6 rounded-lg border border-[#FBBF24]/30 bg-[#FBBF24]/5 p-4 text-sm text-[#FBBF24]'>
            The network has not answered yet; trying again by itself. Nothing on
            this page can be signed until it has.
          </p>
        ))}

      {identity === 'other' && (
        <div className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          <p className='font-semibold'>{IDENTITY_LINE.other}</p>
          <p className='mt-2'>
            Nothing can be signed, carried out, discarded or proposed from this
            page, and do not send it funds on the strength of it.
          </p>
          <p className='mt-2 font-mono text-xs [overflow-wrap:anywhere]'>
            Its code hash is {normalizeCodeHash(contract?.codeHash ?? '')}. The
            multisig's is {normalizeCodeHash(MULTISIG_CODE_HASH)}.
          </p>
        </div>
      )}

      {identity === 'unverified' && overview && overview.quorum !== null && (
        <div className='mt-6 rounded-lg border border-[#FBBF24]/30 bg-[#FBBF24]/5 p-4 text-sm text-[#FBBF24]'>
          <p>{IDENTITY_LINE.unverified}</p>
          <p className='mt-2'>
            Nothing can be signed, carried out, discarded or proposed until
            then. This page asks again by itself.{' '}
            <button
              type='button'
              disabled={codeChecking}
              onClick={() => {
                forget(address);
                checkCode();
              }}
              className='font-semibold underline disabled:opacity-50'
            >
              {codeChecking ? 'Checking...' : 'Check again'}
            </button>
          </p>
        </div>
      )}

      {!ownsItself && (
        <div className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          <p>
            This safe is not in its own hands. Its owner can replace the
            contract's code alone, without the board:
          </p>
          <AddressLine
            address={contract?.ownerAddress ?? ''}
            short={false}
            className='mt-2 text-xs'
          />
          {identity === 'other' ? null : youOwnIt ? (
            <div className='mt-3 flex flex-wrap items-center gap-3'>
              <button
                type='button'
                disabled={walletOpen || awaiting || held}
                onClick={handOver}
                className='rounded-lg bg-[#FF6E0A] px-4 py-2 text-xs font-semibold text-black hover:bg-[#ff8534] disabled:opacity-50'
              >
                {handingOver
                  ? 'Waiting for your wallet...'
                  : 'Hand it to itself now'}
              </button>
              <span className='text-xs text-[#F87171]/80'>
                That owner is you. One transaction makes the safe its own owner,
                after which only the board, by quorum, can change it.
              </span>
            </div>
          ) : (
            <p className='mt-2 text-xs text-[#F87171]/80'>
              Ask that owner to hand the safe to itself before trusting it with
              funds.
            </p>
          )}
        </div>
      )}

      {problem && (
        <p className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          {problem}
        </p>
      )}

      {awaiting && !stale && (
        <p className='mt-6 rounded-lg border border-[#2A2A32] bg-[#121218] p-4 text-sm text-[#9AA0A6]'>
          Sent. The network takes a few seconds to process it; this page shows
          the result by itself.
        </p>
      )}

      {/* The contract accepts a quorum of 0, and then nothing needs a signature (SC-02). */}
      {overview?.quorum === 0 && (
        <p className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          This safe needs no signatures: its quorum is 0, so any board member or
          proposer can carry out any action alone. Propose a new quorum before
          anything else.
        </p>
      )}

      {stale && !failed && (
        <p className='mt-6 rounded-lg border border-[#FBBF24]/30 bg-[#FBBF24]/5 p-4 text-sm text-[#FBBF24]'>
          The network did not answer just now, so this is what was read a moment
          ago. It updates by itself; nothing can be signed or carried out until
          it does.
        </p>
      )}

      {prompting && stuck && (
        <p className='mt-6 rounded-lg border border-[#2A2A32] bg-[#121218] p-4 text-sm text-[#9AA0A6]'>
          Your wallet has not answered. If you dismissed the request,{' '}
          <button
            type='button'
            onClick={() => {
              promptRef.current++;
              setWorking(0);
              setHandingOver(false);
            }}
            className='text-[#FF6E0A] hover:underline'
          >
            start over
          </button>
          . If you did sign it, it is on its way and this page will show it by
          itself.
        </p>
      )}

      <div className='mt-6 grid gap-4 md:grid-cols-3'>
        <div className={card}>
          <p className={label + ' flex items-center'}>
            Quorum
            <Info text='How many of the board members have to sign before an action can be carried out.' />
          </p>
          <p className='mt-1 text-2xl font-semibold text-white'>
            {overview && overview.quorum !== null
              ? `${overview.quorum} of ${overview.boardMembers.length}`
              : overview
                ? 'unknown'
                : '...'}
          </p>
          <p className='mt-2 text-xs text-[#6B7280]'>
            {overview
              ? `${overview.proposerCount} proposer${overview.proposerCount === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        <div className={card}>
          <p className={label}>{primary ? primary.identifier : 'Tokens'}</p>
          <p className='mt-1 text-2xl font-semibold text-white'>
            {primary
              ? primary.amount.toLocaleString('en-US', {
                  maximumFractionDigits: 0
                })
              : overview
                ? tokens.length
                : '...'}
            {primary?.valueUsd ? (
              <span className='ml-2 text-sm font-normal text-[#6B7280]'>
                {formatUsd(primary.valueUsd)}
              </span>
            ) : null}
          </p>
          {/* No subtotal here: the holdings card below already lists EGLD and
              the total, and repeating it made the tile say the same thing twice. */}
        </div>
        <div className={card}>
          <p className={label + ' flex items-center'}>
            Actions
            <Info text='Waiting for signatures right now. The number underneath counts every action ever proposed, carried out or discarded.' />
          </p>
          <p className='mt-1 text-2xl font-semibold text-white'>
            {overview ? (pendingCount ?? '?') : '...'}
          </p>
          <p className='mt-2 text-xs text-[#6B7280]'>
            {overview
              ? `${overview.actionCount} in total since deployment`
              : ''}
          </p>
        </div>
      </div>

      <section className='mt-8'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h2 className='flex items-center text-lg font-semibold text-white'>
            Pending actions
            <Info text='Each one is written in plain words. Read it before signing: this is what the safe will do.' />
          </h2>
          {overview && overview.quorum !== null && (
            <form onSubmit={goToAction} className='flex items-center gap-2'>
              <label className='flex items-center gap-2 text-xs text-[#6B7280]'>
                Go to action #
                <input
                  value={goText}
                  onChange={(event) => setGoText(event.target.value)}
                  inputMode='numeric'
                  aria-label='Go to action number'
                  className='w-20 rounded-lg border border-[#2A2A32] bg-[#121218] px-2 py-1 font-mono text-xs text-white'
                />
              </label>
              <button
                type='submit'
                disabled={wantedReading}
                className='rounded-lg border border-[#2A2A32] px-3 py-1 text-xs text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white disabled:opacity-50'
              >
                Go
              </button>
            </form>
          )}
        </div>
        {wantedNote && (
          <p className='mt-3 rounded-lg border border-[#2A2A32] bg-[#121218] p-3 text-sm text-[#9AA0A6]'>
            {wantedNote}
          </p>
        )}
        {wanted && (
          <div className='mt-3'>
            <div className='mb-2 flex items-center justify-between text-xs text-[#6B7280]'>
              <span>The action you asked for:</span>
              <button
                type='button'
                onClick={closeWanted}
                className='hover:text-white'
              >
                Close
              </button>
            </div>
            {renderCard(wanted)}
          </div>
        )}
        {pending === null ? (
          <p className='mt-3 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
            The actions waiting for a signature could not be read. Refresh
            before signing anything.
          </p>
        ) : (
          <>
            {pending.length === 0 && olderUnread === 0 && (
              <p className='mt-3 text-sm text-[#6B7280]'>
                {loading ? 'Loading...' : 'Nothing is waiting for a signature.'}
              </p>
            )}
            {pending.length === 0 && olderUnread > 0 && loading && (
              <p className='mt-3 text-sm text-[#6B7280]'>Loading...</p>
            )}
            {olderUnread > 0 && (
              <p className='mt-3 rounded-lg border border-[#FBBF24]/30 bg-[#FBBF24]/5 p-4 text-sm text-[#FBBF24]'>
                This list is not complete. The contract cannot return its
                pending actions in one piece, so they are read one by one,
                newest first, and {grouped(olderUnread)} older action
                {olderUnread === 1 ? ' number has' : ' numbers have'} not been
                read. Any of them may be waiting for a signature. Nothing can be
                said about them until they are read.
              </p>
            )}
            {olderUnread === 0 && coverage?.oneByOne && cards.length > 0 && (
              <p className='mt-3 text-xs text-[#6B7280]'>
                The contract cannot return its pending actions in one piece, so
                they were read one by one. Every action number has been read.
              </p>
            )}
            {olderKnown > 0 && (
              <p className='mt-3 text-sm text-[#9AA0A6]'>
                Showing {grouped(cards.length)} of{' '}
                {grouped(coverage?.pendingCount ?? cards.length + olderKnown)}{' '}
                pending actions: those with a signature first, then the newest.
                The other {grouped(olderKnown)} are not shown yet;{' '}
                {coverage?.signedNotShown
                  ? `${grouped(coverage.signedNotShown)} of them with a signature.`
                  : 'none of them carries a signature that counts.'}
              </p>
            )}
            <div className='mt-3 space-y-3'>
              {cards
                .filter((listed) => listed.actionId !== wanted?.actionId)
                .map(renderCard)}
            </div>
            {(olderUnread > 0 || olderKnown > 0) && (
              <div className='mt-3 flex flex-wrap items-center gap-3'>
                <button
                  type='button'
                  disabled={loadingMore || loading}
                  onClick={loadMore}
                  className='rounded-lg border border-[#2A2A32] px-4 py-2 text-sm text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white disabled:opacity-50'
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
                <span className='text-xs text-[#6B7280]'>
                  {olderUnread > 0
                    ? `${grouped(olderUnread)} older not read`
                    : `${grouped(olderKnown)} more not shown`}
                </span>
                {moreFailed && (
                  <span className='text-xs text-[#FBBF24]'>
                    The network did not answer for all of them. Press it again
                    to go on from where it stopped.
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {isLoggedIn && canPropose && overview && (
        <ProposePanel
          safe={address}
          signer={signer}
          tokens={overview.tokens}
          tokensNotRead={overview.tokensNotRead}
          egldBalance={overview.egldRaw}
          boardSize={overview.boardMembers.length}
          boardMembers={overview.boardMembers}
          proposers={overview.proposers ?? []}
          quorum={overview.quorum}
          disabled={working !== 0 || handingOver || stale || awaiting || held}
          disabledReason={
            held
              ? 'Held: read the line at the top of this page.'
              : awaiting
                ? 'Waiting for the network to confirm the last transaction; this unlocks by itself.'
                : stale
                  ? 'The network did not answer the last read; this unlocks as soon as it does.'
                  : working !== 0 || handingOver
                    ? 'Another transaction is waiting for your wallet.'
                    : undefined
          }
          onBusyChange={setProposing}
          onProposed={(sent) => {
            // Sent: like a signature, the form waits for the processed signal,
            // or a second press files the same proposal again before the
            // first is visible (web audit BRW-07). Not sent, but the wallet saw
            // it: only the chain can say whether it went through (WEB-07).
            if (sent) {
              awaitNetwork();
            } else {
              forget(address);
              load();
            }
          }}
        />
      )}

      {/* items-start: each card takes its own height, so a long list of
          proposers does not stretch the holdings beside it. */}
      <div className='mt-8 grid items-start gap-4 md:grid-cols-2'>
        <section className={card}>
          <h2 className='flex items-center text-lg font-semibold text-white'>
            Board and proposers
            <Info text='Board members propose, sign and carry out actions. Proposers can propose, and carry out an action once the board has signed it, but cannot sign: their actions still need the board. The pencil gives an address a name, kept in this browser and carried in the export file.' />
          </h2>
          <p className='mt-3 text-xs tracking-wider text-[#6B7280] uppercase'>
            Board
          </p>
          <ul className='mt-3 space-y-2'>
            {(overview?.boardMembers ?? []).map((member) => (
              <li
                key={member}
                className='flex items-center justify-between gap-2'
              >
                <AddressLine
                  address={member}
                  nameable
                  className='text-xs text-[#9AA0A6]'
                />
                {member === account.address && (
                  <span className='text-[10px] tracking-wider text-[#FF6E0A] uppercase'>
                    you
                  </span>
                )}
              </li>
            ))}
            {!overview && <li className='text-sm text-[#6B7280]'>...</li>}
            {overview && overview.boardMembers.length === 0 && (
              <li className='text-sm text-[#6B7280]'>
                No board members found.
              </li>
            )}
          </ul>

          <p className='mt-5 text-xs tracking-wider text-[#6B7280] uppercase'>
            Proposers
          </p>
          <ul className='mt-3 space-y-2'>
            {(overview?.proposers ?? []).map((proposer) => (
              <li
                key={proposer}
                className='flex items-center justify-between gap-2'
              >
                <AddressLine
                  address={proposer}
                  nameable
                  className='text-xs text-[#9AA0A6]'
                />
                {proposer === account.address && (
                  <span className='text-[10px] tracking-wider text-[#FF6E0A] uppercase'>
                    you
                  </span>
                )}
              </li>
            ))}
            {overview && (overview.proposers ?? []).length === 0 && (
              <li className='text-sm text-[#6B7280]'>No proposers.</li>
            )}
          </ul>
        </section>

        <section className={card}>
          <h2 className='flex items-center text-lg font-semibold text-white'>
            Holdings
            <Info text='Dollar values come from the same MultiversX API as the balances. They only exist for tokens that have a market price.' />
          </h2>
          <ul className='mt-3 space-y-2 text-sm'>
            <li className='flex justify-between'>
              <span className='text-[#9AA0A6]'>EGLD</span>
              <span className='text-white'>
                {overview ? overview.egld.toFixed(4) : '...'}
                {overview?.egldPrice && overview.egld > 0 ? (
                  <span className='ml-2 text-xs text-[#6B7280]'>
                    {formatUsd(overview.egld * overview.egldPrice)}
                  </span>
                ) : null}
              </span>
            </li>
            {holdingsShown.map((token) => (
              <li key={token.identifier} className='flex justify-between'>
                {/* Always the identifier: anyone can send the safe a token
                    with any ticker, and a contract the safe owns pays its
                    fees in whatever token it handles (14 Oct 2026). */}
                <span className='text-[#9AA0A6] [overflow-wrap:anywhere]'>
                  {token.identifier}
                </span>
                <span className='text-white'>
                  {token.amount.toLocaleString('en-US', {
                    maximumFractionDigits: 2
                  })}
                  {token.valueUsd ? (
                    <span className='ml-2 text-xs text-[#6B7280]'>
                      {formatUsd(token.valueUsd)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
            {holdings.length > holdingsShown.length && (
              <li>
                <button
                  type='button'
                  onClick={() => setAllTokens(true)}
                  className='text-xs text-[#FF6E0A] hover:underline'
                >
                  Show all {grouped(holdings.length)} tokens
                </button>
              </li>
            )}
            {overview &&
              overview.tokensNotRead !== 0 &&
              overview.tokensNotRead !== undefined && (
                <li className='text-xs text-[#FBBF24]'>
                  {tokensNotReadLine(tokens.length, overview.tokensNotRead)}
                </li>
              )}
            {overview && overview.worthUsd > 0 && (
              <li className='flex justify-between border-t border-[#2A2A32] pt-2'>
                <span className='text-[#9AA0A6]'>Total</span>
                <span className='text-white'>
                  {formatUsd(overview.worthUsd)}
                </span>
              </li>
            )}
            {overview && overview.nftCount > 0 && (
              <li className='flex justify-between'>
                <span className='text-[#9AA0A6]'>NFTs</span>
                <span className='text-white'>{overview.nftCount}</span>
              </li>
            )}
          </ul>
        </section>
      </div>

      <section className='mt-8'>
        <h2 className='text-lg font-semibold text-white'>History</h2>
        <div className='mt-3 overflow-hidden rounded-xl border border-[#2A2A32]'>
          <table className='w-full text-left text-sm'>
            <thead className='bg-[#121218] text-xs text-[#6B7280]'>
              <tr>
                <th className='px-4 py-3'>When</th>
                <th className='px-4 py-3'>Action</th>
                <th className='px-4 py-3'>By</th>
                <th className='px-4 py-3'>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.txHash} className='border-t border-[#2A2A32]'>
                  <td className='px-4 py-3 text-[#9AA0A6]'>
                    {new Date(entry.timestamp * 1000).toLocaleDateString(
                      'en-GB',
                      {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        timeZone: 'UTC'
                      }
                    )}
                  </td>
                  <td className='px-4 py-3 text-white'>{entry.functionName}</td>
                  <td className='px-4 py-3 font-mono text-xs text-[#6B7280]'>
                    {/* The same names as the board, never the raw address beside them. */}
                    <AddressLine
                      address={entry.sender}
                      className='text-xs text-[#6B7280]'
                    />
                  </td>
                  <td className='px-4 py-3'>
                    <a
                      href={`${explorerUrl}/transactions/${entry.txHash}`}
                      target='_blank'
                      rel='noreferrer'
                      className='font-mono text-xs text-[#FF6E0A] hover:underline'
                    >
                      {entry.txHash.slice(0, 10)}...
                    </a>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className='px-4 py-6 text-center text-sm text-[#6B7280]'
                  >
                    {historyRead ? 'No transactions found.' : 'Loading...'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
