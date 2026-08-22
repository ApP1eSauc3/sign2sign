import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { PhotoLocation } from './JobPhotoService';
import { secureStorage } from '../utils/secureStorage';

const QUEUE_KEY = 'offline_queue';

// The route code is the driver's credential — it must never sit in
// AsyncStorage, which is plaintext on both platforms and rides into device
// backups. It lives in secureStorage (Keychain / Keystore / OS keychain via
// safeStorage on Electron) under its own key, separate from the queue.
//
// Why split rather than move the whole queue into secureStorage: the queue
// carries a local file URI per photo and grows with the route, which pushes
// past the size a Keychain generic-password item is comfortable holding. The
// code is six digits. Keeping the bulk in AsyncStorage and the credential in
// the keychain gets both properties.
const ROUTE_CODE_KEY = 'offline_queue_route_code';

export type QueuedOperation =
  | {
      type: 'upload';
      jobId: string;
      imageUri: string;
      location: PhotoLocation;
      queuedAt: number;
    }
  | {
      type: 'markComplete';
      jobId: string;
      queuedAt: number;
    };

export type FlushResult = {
  succeeded: string[];   // jobIds
  failed: string[];      // jobIds
};

// ─── Write serialization ─────────────────────────────────────────────────────
//
// Every queue mutation is a read-modify-write: read the JSON blob, filter or
// append, write it back. AsyncStorage offers no transaction, no compare-and-
// swap, and no ordering guarantee between concurrent callers — two overlapping
// mutations both read the same "before" value and the second write silently
// discards the first. In this app that is a driver's photo disappearing from
// the queue and never uploading, which is completion evidence lost.
//
// It is not hypothetical here. OfflineBanner is mounted on all three driver
// screens, each with its own useNetworkStatus poll, so a single reconnect
// fires flushOfflineQueue() once per mounted screen; loadSession and
// DriverCodeScreen call it too.
//
// The upstream project also documents parallel setItem as a crash/corruption
// path on Android (async-storage#125), and mergeItem — the obvious primitive
// for this — is not supported by every native implementation and crashes on
// JSON arrays (async-storage#699). So serialization has to happen on our side.
//
// A promise chain is the whole mechanism: each critical section waits for the
// previous one to settle. It is deliberately NOT reentrant — helpers that run
// inside the lock must call the unlocked readQueue/writeQueue primitives, never
// the public methods, or they deadlock against themselves.
let queueLock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(critical: () => Promise<T>): Promise<T> {
  // Run on both settle paths — a failed mutation must not wedge every
  // subsequent one behind a permanently rejected promise.
  const run = queueLock.then(critical, critical);
  // The chain itself only sequences; it must never carry a rejection forward.
  queueLock = run.catch(() => undefined);
  return run;
}

// Unlocked primitives. Call these only from inside withQueueLock.
async function readQueue(): Promise<QueuedOperation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedOperation[]) : [];
  } catch {
    // Corrupt blob — treat as empty rather than wedging the queue forever.
    return [];
  }
}

async function writeQueue(queue: QueuedOperation[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// ─── Flush coalescing ────────────────────────────────────────────────────────
//
// The lock makes concurrent mutations safe but does not stop two flushes from
// both reading the same pending op and both running its handler — a duplicate
// upload, or a second complete_job call. Coalescing means the second caller
// awaits the first flush's result instead of starting a competing one.
let inFlightFlush: Promise<FlushResult> | null = null;

export const OfflineQueueService = {
  async isOnline(): Promise<boolean> {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  },

  // routeCode is stored separately and securely; it is not part of the op.
  // A driver holds one active code at a time, so a later enqueue under a new
  // code overwrites it. Ops queued under a *previous* code will then fail
  // authorization in complete_job() / recover_existing_photo() and surface
  // the existing "route code is no longer valid" message — which is the
  // correct outcome, since those jobs belong to a route the driver has left.
  async enqueue(op: QueuedOperation, routeCode: string): Promise<void> {
    await withQueueLock(async () => {
      const current = await readQueue();
      // Deduplicate: replace an existing op for the same jobId + type
      const filtered = current.filter(
        (o) => !(o.type === op.type && o.jobId === op.jobId)
      );
      filtered.push(op);
      // Credential first: a queue entry with no code to authorize it is a
      // stuck op, whereas a code with no queue is inert and gets cleaned up
      // by the next remove() that empties the queue.
      await secureStorage.setItem(ROUTE_CODE_KEY, routeCode);
      await writeQueue(filtered);
    });
  },

  async getQueue(): Promise<QueuedOperation[]> {
    // Deliberately unlocked. This is a pure read of a self-consistent snapshot
    // (AsyncStorage writes are whole-value), so it cannot observe a torn queue,
    // and keeping it lock-free means a caller holding the lock can still be
    // inspected in tests without deadlocking.
    return readQueue();
  },

  async remove(jobId: string, type: QueuedOperation['type']): Promise<void> {
    await withQueueLock(async () => {
      // Re-read inside the lock rather than trusting a caller's snapshot.
      // flush() holds an array it read seconds ago; writing that back would
      // erase anything enqueued while an upload was in flight.
      const current = await readQueue();
      const filtered = current.filter(
        (o) => !(o.jobId === jobId && o.type === type)
      );
      await writeQueue(filtered);
      if (filtered.length === 0) await secureStorage.removeItem(ROUTE_CODE_KEY);
    });
  },

  async clearAll(): Promise<void> {
    await withQueueLock(async () => {
      await AsyncStorage.removeItem(QUEUE_KEY);
      await secureStorage.removeItem(ROUTE_CODE_KEY);
    });
  },

  // Flush the queue, calling the provided handlers for each operation type.
  // The route code is read from secure storage here and handed to each
  // handler — it is never persisted alongside the op itself.
  // Returns which jobIds succeeded and which failed so the store can update state.
  //
  // Concurrent callers are coalesced onto one run (see inFlightFlush) and all
  // receive the same FlushResult.
  //
  // Caveat, stated rather than hidden: only the FIRST caller's handlers run.
  // Every call site in this app passes the same store-bound handlers, so that
  // is currently a distinction without a difference — but if a caller ever
  // needs its own handlers invoked, this coalescing is the thing to revisit.
  //
  // Handlers run OUTSIDE the queue lock. An upload is seconds of network I/O;
  // holding the lock across it would block a driver enqueueing their next
  // photo behind the previous one's upload. Only the per-op removal that
  // follows takes the lock.
  //
  // Cost note: removal is one read-modify-write per completed op, so a flush
  // of n ops rewrites the blob n times — O(n²) bytes. That is a deliberate
  // trade, not an oversight. Persisting once at the end would be O(n) but
  // replays completed ops after a mid-flush crash (iOS kills backgrounded apps
  // routinely), and a replayed upload orphans a storage object under a fresh
  // timestamped key. Per-op durability is worth more than the bytes at a
  // realistic queue depth of one route (tens of ops, ~10KB). If the queue ever
  // holds hundreds, switch to one AsyncStorage key per op plus a small index.
  async flush(handlers: {
    onUpload: (op: Extract<QueuedOperation, { type: 'upload' }>, routeCode: string) => Promise<void>;
    onMarkComplete: (op: Extract<QueuedOperation, { type: 'markComplete' }>, routeCode: string) => Promise<void>;
  }): Promise<FlushResult> {
    if (inFlightFlush) return inFlightFlush;

    const run = (async (): Promise<FlushResult> => {
      const queue = await OfflineQueueService.getQueue();
      const succeeded: string[] = [];
      const failed: string[] = [];

      if (queue.length === 0) return { succeeded, failed };

      // No stored code means nothing in the queue can be authorized, so the
      // handlers never run and nothing reaches the UI. Reporting the ops as
      // failed at least puts it in the return value.
      //
      // Being honest about the limit: useDriverSession currently discards
      // FlushResult, so this branch is silent to the driver. It is a rare state
      // (queue present, keychain entry gone) and fixing it properly means the
      // store consuming the result — which belongs with the security-event
      // logging work, not here.
      const routeCode = await secureStorage.getItem(ROUTE_CODE_KEY);
      if (!routeCode) {
        return { succeeded, failed: queue.map((o) => o.jobId) };
      }

      for (const op of queue) {
        try {
          if (op.type === 'upload') {
            await handlers.onUpload(op, routeCode);
          } else {
            await handlers.onMarkComplete(op, routeCode);
          }
          await OfflineQueueService.remove(op.jobId, op.type);
          succeeded.push(op.jobId);
        } catch {
          failed.push(op.jobId);
        }
      }

      return { succeeded, failed };
    })();

    inFlightFlush = run;
    try {
      return await run;
    } finally {
      inFlightFlush = null;
    }
  },
};
