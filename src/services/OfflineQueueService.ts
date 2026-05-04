import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { PhotoLocation } from './JobPhotoService';

const QUEUE_KEY = 'offline_queue';

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
      routeCode: string;  // required by complete_job() RPC for authorization
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

  async enqueue(op: QueuedOperation): Promise<void> {
    const current = await OfflineQueueService.getQueue();
    // Deduplicate: replace an existing op for the same jobId + type
    const filtered = current.filter(
      (o) => !(o.type === op.type && o.jobId === op.jobId)
    );
    filtered.push(op);
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
  },

  async clearAll(): Promise<void> {
    await AsyncStorage.removeItem(QUEUE_KEY);
  },

  // Flush the queue, calling the provided handlers for each operation type.
  // Returns which jobIds succeeded and which failed so the store can update state.
  async flush(handlers: {
    onUpload: (op: Extract<QueuedOperation, { type: 'upload' }>) => Promise<void>;
    onMarkComplete: (op: Extract<QueuedOperation, { type: 'markComplete' }>) => Promise<void>;
  }): Promise<FlushResult> {
    const queue = await OfflineQueueService.getQueue();
    const succeeded: string[] = [];
    const failed: string[] = [];

    for (const op of queue) {
      try {
        if (op.type === 'upload') {
          await handlers.onUpload(op);
        } else {
          await handlers.onMarkComplete(op);
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
