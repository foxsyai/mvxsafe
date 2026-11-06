// sdk-dapp shows a toast for every transaction sent from here and settles it
// from its own reads of /transactions?hashes=: every 9 s, or every second while
// its websocket is down. Those reads bypass mvxsafe's paced queue, and two of
// its ways out are wrong (the stuck toast of 14 Oct 2026, left open by the
// audit of 21 Oct). A refused read (429) is only logged, so a run of them keeps
// the toast spinning for as long as it lasts. And 31 reads that miss the hash
// mark the session timed out for good, even when the transaction succeeds a
// moment later.
//
// So mvxsafe looks too, through its own queue: a session sdk-dapp has not
// settled within FIRST_LOOK_MS, or one it gave up on, is read from the nodes
// (the gateway's process-status, as sdk-core reads it) and then from the API's
// record, and the network's answer goes into sdk-dapp's store, which is what
// the toast shows. The API alone is not enough: on devnet its index still
// called a transaction pending minutes after the nodes had run it (6 Nov 2026).

import {
  addTransactionToast,
  getCallbacks,
  getStore,
  updateSessionStatus,
  updateTransactionStatus
} from 'lib/sdkDapp/sdkDapp.helpers';
import {
  SessionTransactionType,
  TransactionBatchStatusesEnum,
  TransactionServerStatusesEnum
} from 'lib/sdkDapp/sdkDapp.types';
import { apiFresh, gatewayFresh } from 'multisig/network';

/** A healthy session settles well within this, and is left to sdk-dapp until then. */
export const FIRST_LOOK_MS = 20_000;
export const LOOK_EVERY_MS = 10_000;
/** After this, a session the network gives no final answer for is let go. */
export const GIVE_UP_MS = 10 * 60_000;
/** Older sessions, by the time in their id, are history restored from storage. */
export const SESSION_MAX_AGE_MS = 60 * 60_000;
const TICK_MS = 2_000;

const { sent, timedOut, success, fail } = TransactionBatchStatusesEnum;
// Shown as processing by the toast, and ignored by sdk-dapp's tracker, which
// only follows sessions marked "sent". Only mvxsafe gives a session this status.
const PROCESSING =
  TransactionServerStatusesEnum.pending as unknown as TransactionBatchStatusesEnum;

export interface NetworkAnswer {
  status: 'success' | 'fail' | 'invalid' | 'pending';
  returnMessage?: string;
}

const ANSWERS = new Set(['success', 'fail', 'invalid', 'pending']);
const FINAL = new Set(['success', 'fail', 'invalid']);
const HASH = /^[0-9a-f]{64}$/;

/** "…[error signalled by smartcontract] [performAction]…[quorum has not been reached]" → its last part. */
const reasonOf = (reason?: string) => {
  const parts = [...String(reason ?? '').matchAll(/\[([^\]]+)\]/g)];
  const said = parts.length ? parts[parts.length - 1][1] : String(reason ?? '');
  return said.trim().slice(0, 200) || undefined;
};

const fromNodes = async (hash: string): Promise<NetworkAnswer | null> => {
  try {
    const answer = await gatewayFresh<{
      code?: string;
      data?: { status?: string; reason?: string };
    }>(`/transaction/${hash}/process-status`);
    const status = String(answer?.data?.status);
    if (answer?.code !== 'successful' || !ANSWERS.has(status)) return null;
    const returnMessage =
      status === 'success' ? undefined : reasonOf(answer.data?.reason);
    return {
      status: status as NetworkAnswer['status'],
      ...(returnMessage ? { returnMessage } : {})
    };
  } catch {
    return null;
  }
};

const fromIndex = async (hash: string): Promise<NetworkAnswer | null> => {
  try {
    const answer = await apiFresh<{
      txHash?: string;
      status?: string;
      results?: { returnMessage?: string }[];
    }>(`/transactions/${hash}?fields=txHash,status,results`);
    if (answer?.txHash !== hash || !ANSWERS.has(String(answer.status))) {
      return null;
    }
    const returnMessage = (answer.results ?? []).find(
      (result) => result?.returnMessage
    )?.returnMessage;
    return {
      status: answer.status as NetworkAnswer['status'],
      ...(returnMessage ? { returnMessage } : {})
    };
  } catch {
    return null;
  }
};

/**
 * What the network says about one transaction: the nodes' answer when it is
 * final, else the API's, else whichever says it is still pending; null when
 * neither gave a usable answer (not found yet, or refused after the retries).
 */
export const readTransaction = async (
  hash: string
): Promise<NetworkAnswer | null> => {
  if (!HASH.test(hash)) return null;
  const nodes = await fromNodes(hash);
  if (nodes && FINAL.has(nodes.status)) return nodes;
  const index = await fromIndex(hash);
  if (index && FINAL.has(index.status)) return index;
  return nodes ?? index;
};

interface Watch {
  firstSeen: number;
  nextLook: number;
  looking: boolean;
  done: boolean;
  sawTimedOut: boolean;
  errorMessage?: string;
}

const monotonic = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

const isOpen = (status: string) =>
  status === sent || status === timedOut || status === PROCESSING;

const unsettled = (session?: SessionTransactionType) =>
  (session?.transactions ?? []).filter(
    ({ hash, status }) => HASH.test(String(hash)) && !FINAL.has(String(status))
  );

/** The session's result once every transaction in it has one, else null. */
const outcomeOf = (session: SessionTransactionType) => {
  const statuses = session.transactions.map(({ status }) => String(status));
  if (statuses.length === 0 || !statuses.every((status) => FINAL.has(status))) {
    return null;
  }
  return statuses.every((status) => status === 'success') ? success : fail;
};

export const createSettler = ({
  read = readTransaction,
  now = monotonic,
  wallNow = () => Date.now(),
  soon = (run: () => void) => {
    setTimeout(run, 0);
  }
}: {
  read?: (hash: string) => Promise<NetworkAnswer | null>;
  now?: () => number;
  wallNow?: () => number;
  soon?: (run: () => void) => void;
} = {}) => {
  const store = getStore();
  const sessions = (): Record<string, SessionTransactionType> =>
    store.getState().transactions ?? {};
  const watches = new Map<string, Watch>();
  // The status mvxsafe gave each session it settled or took back.
  const written = new Map<string, TransactionBatchStatusesEnum>();

  const write = (sessionId: string, status: TransactionBatchStatusesEnum) => {
    written.set(sessionId, status);
    updateSessionStatus({ sessionId, status });
  };

  const settle = async (
    sessionId: string,
    outcome: TransactionBatchStatusesEnum,
    before: string,
    errorMessage?: string
  ) => {
    written.set(sessionId, outcome);
    updateSessionStatus({
      sessionId,
      status: outcome,
      ...(outcome === fail && errorMessage ? { errorMessage } : {})
    });
    // A finished toast closes itself after five seconds: one that said "timed
    // out" may be gone by now, and the answer that corrects it is shown again.
    const shown = store
      .getState()
      .toasts?.transactionToasts?.some(({ toastId }) => toastId === sessionId);
    if (before !== sent && !shown) {
      addTransactionToast({ toastId: sessionId, totalDuration: 0 });
    }
    // What sdk-dapp runs when it settles a session: here, the pages' re-read.
    const callbacks = getCallbacks(sessionId);
    try {
      await (outcome === success ? callbacks?.onSuccess : callbacks?.onFail)?.(
        sessionId
      );
    } catch {
      // The pages also re-read on their own clock.
    }
  };

  const look = async (sessionId: string, watch: Watch) => {
    watch.looking = true;
    try {
      const asked = unsettled(sessions()[sessionId]);
      const answers = await Promise.all(asked.map(({ hash }) => read(hash)));
      const session = sessions()[sessionId];
      const before = String(session?.status ?? '');
      // Cleared, or settled by sdk-dapp meanwhile: its answer stands.
      if (!session || !isOpen(before)) {
        watch.done = true;
        return;
      }
      for (const [at, transaction] of asked.entries()) {
        const answer = answers[at];
        if (!answer || !FINAL.has(answer.status)) continue;
        if (answer.status !== 'success' && answer.returnMessage) {
          watch.errorMessage ??= answer.returnMessage;
        }
        updateTransactionStatus({
          sessionId,
          transaction: {
            ...transaction,
            status: answer.status as TransactionServerStatusesEnum,
            inTransit: false
          }
        });
      }
      const outcome = outcomeOf(sessions()[sessionId]);
      if (outcome) {
        watch.done = true;
        await settle(sessionId, outcome, before, watch.errorMessage);
        return;
      }
      // sdk-dapp gave up, but the network holds the transaction and is still
      // at work on it: the toast goes back to processing.
      if (before === timedOut && answers.some((answer) => answer !== null)) {
        write(sessionId, PROCESSING);
      }
    } finally {
      watch.looking = false;
      watch.nextLook = now() + LOOK_EVERY_MS;
    }
  };

  const tick = async () => {
    const at = now();
    const all = sessions();
    for (const sessionId of watches.keys()) {
      if (!all[sessionId]) watches.delete(sessionId);
    }
    const looks: Promise<void>[] = [];
    for (const [sessionId, session] of Object.entries(all)) {
      const status = String(session?.status ?? '');
      const born = Number(sessionId);
      if (
        !isOpen(status) ||
        !Number.isFinite(born) ||
        wallNow() - born > SESSION_MAX_AGE_MS ||
        unsettled(session).length === 0
      ) {
        continue;
      }
      let watch = watches.get(sessionId);
      if (!watch) {
        watch = {
          firstSeen: at,
          nextLook: status === sent ? at + FIRST_LOOK_MS : at,
          looking: false,
          done: false,
          sawTimedOut: false
        };
        watches.set(sessionId, watch);
      }
      if (watch.done || watch.looking) continue;
      if (status === timedOut && !watch.sawTimedOut) {
        watch.sawTimedOut = true;
        watch.nextLook = at;
      }
      if (at - watch.firstSeen >= GIVE_UP_MS) {
        watch.done = true;
        // Taken back to processing and never finished: as sdk-dapp had it.
        if (status === PROCESSING) write(sessionId, timedOut);
        continue;
      }
      if (at >= watch.nextLook) looks.push(look(sessionId, watch));
    }
    await Promise.all(looks);
  };

  const unsubscribe = store.subscribe((state, previous) => {
    const current = state.transactions ?? {};
    const before = previous?.transactions ?? {};
    for (const [sessionId, mine] of written) {
      const session = current[sessionId];
      if (!session) {
        written.delete(sessionId);
        continue;
      }
      // A check sdk-dapp started before the network's answer came in may end
      // in its "timed out" after it.
      if (session.status === timedOut && mine !== timedOut) {
        queueMicrotask(() => {
          if (sessions()[sessionId]?.status === timedOut) {
            updateSessionStatus({ sessionId, status: mine });
          }
        });
      }
    }
    const gaveUp = Object.entries(current).some(
      ([sessionId, session]) =>
        session?.status === timedOut &&
        before[sessionId]?.status !== timedOut &&
        !written.has(sessionId)
    );
    if (gaveUp) soon(() => void tick());
  });

  return { tick, stop: unsubscribe };
};

/** Started once sdk-dapp's store is up; returns what stops it. */
export const settleTrackedTransactions = () => {
  const settler = createSettler();
  const timer = setInterval(() => void settler.tick(), TICK_MS);
  return () => {
    clearInterval(timer);
    settler.stop();
  };
};
