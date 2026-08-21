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
    const current = await OfflineQueueService.getQueue();
    // Deduplicate: replace an existing op for the same jobId + type
    const filtered = current.filter(
      (o) => !(o.type === op.type && o.jobId === op.jobId)
    );
    filtered.push(op);
    await secureStorage.setItem(ROUTE_CODE_KEY, routeCode);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
  },

  async getQueue(): Promise<QueuedOperation[]> {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as QueuedOperation[];
    } catch {
      return [];
    }
  },

  async remove(jobId: string, type: QueuedOperation['type']): Promise<void> {
    const current = await OfflineQueueService.getQueue();
    const filtered = current.filter(
      (o) => !(o.jobId === jobId && o.type === type)
    );
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
    if (filtered.length === 0) await secureStorage.removeItem(ROUTE_CODE_KEY);
  },

  async clearAll(): Promise<void> {
    await AsyncStorage.removeItem(QUEUE_KEY);
    await secureStorage.removeItem(ROUTE_CODE_KEY);
  },

  // Flush the queue, calling the provided handlers for each operation type.
  // The route code is read from secure storage here and handed to each
  // handler — it is never persisted alongside the op itself.
  // Returns which jobIds succeeded and which failed so the store can update state.
  async flush(handlers: {
    onUpload: (op: Extract<QueuedOperation, { type: 'upload' }>, routeCode: string) => Promise<void>;
    onMarkComplete: (op: Extract<QueuedOperation, { type: 'markComplete' }>, routeCode: string) => Promise<void>;
  }): Promise<FlushResult> {
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
  },
};
