import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineQueueService, QueuedOperation } from '../OfflineQueueService';
import { secureStorage } from '../../utils/secureStorage';

// ─── Fakes ───────────────────────────────────────────────────────────────────
//
// AsyncStorage is faked rather than jest.fn()-stubbed because the behaviour
// under test IS the interleaving. Every operation yields to the macrotask queue
// before touching the backing Map, which is what lets two overlapping
// read-modify-write sequences actually observe each other's stale reads. A
// Promise.resolve()-style mock resolves on the microtask queue and can hide the
// exact race this service exists to prevent.

const backing = new Map<string, string>();
let ioDelayMs = 0;

const yieldIo = () => new Promise((resolve) => setTimeout(resolve, ioDelayMs));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(),
}));

jest.mock('../../utils/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockSecure = secureStorage as jest.Mocked<typeof secureStorage>;

const secureBacking = new Map<string, string>();

beforeEach(() => {
  backing.clear();
  secureBacking.clear();
  ioDelayMs = 0;

  mockAsyncStorage.getItem.mockImplementation(async (key: string) => {
    await yieldIo();
    return backing.get(key) ?? null;
  });
  mockAsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
    await yieldIo();
    backing.set(key, value);
  });
  mockAsyncStorage.removeItem.mockImplementation(async (key: string) => {
    await yieldIo();
    backing.delete(key);
  });

  mockSecure.getItem.mockImplementation(async (key: string) => secureBacking.get(key) ?? null);
  mockSecure.setItem.mockImplementation(async (key: string, value: string) => {
    secureBacking.set(key, value);
  });
  mockSecure.removeItem.mockImplementation(async (key: string) => {
    secureBacking.delete(key);
  });
});

function uploadOp(jobId: string, over: Partial<Extract<QueuedOperation, { type: 'upload' }>> = {}) {
  return {
    type: 'upload' as const,
    jobId,
    imageUri: `file:///tmp/${jobId}.jpg`,
    location: { latitude: -31.95, longitude: 115.86 },
    queuedAt: 1,
    ...over,
  };
}

function markCompleteOp(jobId: string) {
  return { type: 'markComplete' as const, jobId, queuedAt: 1 };
}

function noopHandlers() {
  return {
    onUpload: jest.fn().mockResolvedValue(undefined),
    onMarkComplete: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── enqueue ─────────────────────────────────────────────────────────────────

describe('enqueue', () => {
  it('persists the op and stores the route code in secure storage, not AsyncStorage', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');

    const queue = await OfflineQueueService.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].jobId).toBe('job-1');

    // The credential is the whole point of the split — it must not appear in
    // the plaintext blob.
    expect(secureBacking.get('offline_queue_route_code')).toBe('123456');
    expect(JSON.stringify([...backing.values()])).not.toContain('123456');
  });

  it('deduplicates on jobId + type, keeping the newest op', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1', { queuedAt: 1 }), '123456');
    await OfflineQueueService.enqueue(uploadOp('job-1', { queuedAt: 2 }), '123456');

    const queue = await OfflineQueueService.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].queuedAt).toBe(2);
  });

  it('treats the same jobId with a different type as a separate op', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');
    await OfflineQueueService.enqueue(markCompleteOp('job-1'), '123456');

    const queue = await OfflineQueueService.getQueue();
    expect(queue.map((o) => o.type).sort()).toEqual(['markComplete', 'upload']);
  });

  // The regression this component exists to fix. Against the pre-lock
  // implementation both enqueues read the same empty queue and the second
  // write erases the first — one driver photo silently never uploads.
  it('does not lose writes when enqueues overlap', async () => {
    ioDelayMs = 5;

    await Promise.all([
      OfflineQueueService.enqueue(uploadOp('job-1'), '123456'),
      OfflineQueueService.enqueue(uploadOp('job-2'), '123456'),
      OfflineQueueService.enqueue(uploadOp('job-3'), '123456'),
    ]);

    const queue = await OfflineQueueService.getQueue();
    expect(queue.map((o) => o.jobId).sort()).toEqual(['job-1', 'job-2', 'job-3']);
  });
});

// ─── getQueue ────────────────────────────────────────────────────────────────

describe('getQueue', () => {
  it('returns an empty queue when nothing is stored', async () => {
    expect(await OfflineQueueService.getQueue()).toEqual([]);
  });

  it('returns an empty queue rather than throwing on a corrupt blob', async () => {
    backing.set('offline_queue', '{not json');
    expect(await OfflineQueueService.getQueue()).toEqual([]);
  });

  it('returns an empty queue when the stored JSON is not an array', async () => {
    // Valid JSON of the wrong shape used to flow straight through the cast and
    // blow up later in flush's for..of.
    backing.set('offline_queue', '{"jobId":"job-1"}');
    expect(await OfflineQueueService.getQueue()).toEqual([]);
  });
});

// ─── remove ──────────────────────────────────────────────────────────────────

describe('remove', () => {
  it('removes only the matching jobId + type', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');
    await OfflineQueueService.enqueue(markCompleteOp('job-1'), '123456');

    await OfflineQueueService.remove('job-1', 'upload');

    const queue = await OfflineQueueService.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('markComplete');
  });

  it('drops the stored route code once the queue empties', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');
    expect(secureBacking.get('offline_queue_route_code')).toBe('123456');

    await OfflineQueueService.remove('job-1', 'upload');
    expect(secureBacking.has('offline_queue_route_code')).toBe(false);
  });

  it('keeps the route code while other ops remain', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');
    await OfflineQueueService.enqueue(uploadOp('job-2'), '123456');

    await OfflineQueueService.remove('job-1', 'upload');
    expect(secureBacking.get('offline_queue_route_code')).toBe('123456');
  });
});

// ─── clearAll ────────────────────────────────────────────────────────────────

describe('clearAll', () => {
  it('drops both the queue and the credential', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');
    await OfflineQueueService.clearAll();

    expect(await OfflineQueueService.getQueue()).toEqual([]);
    expect(secureBacking.has('offline_queue_route_code')).toBe(false);
  });
});

// ─── flush ───────────────────────────────────────────────────────────────────

describe('flush', () => {
  it('is a no-op on an empty queue and never reads the credential', async () => {
    const handlers = noopHandlers();
    const result = await OfflineQueueService.flush(handlers);

    expect(result).toEqual({ succeeded: [], failed: [] });
    expect(handlers.onUpload).not.toHaveBeenCalled();
    expect(mockSecure.getItem).not.toHaveBeenCalled();
  });

  it('routes each op to the handler for its type, passing the stored route code', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');
    await OfflineQueueService.enqueue(markCompleteOp('job-2'), '123456');

    const handlers = noopHandlers();
    const result = await OfflineQueueService.flush(handlers);

    expect(handlers.onUpload).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', type: 'upload' }),
      '123456'
    );
    expect(handlers.onMarkComplete).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-2', type: 'markComplete' }),
      '123456'
    );
    expect(result.succeeded.sort()).toEqual(['job-1', 'job-2']);
    expect(await OfflineQueueService.getQueue()).toEqual([]);
  });

  it('keeps a failed op queued for the next flush and reports it', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');
    await OfflineQueueService.enqueue(uploadOp('job-2'), '123456');

    const handlers = noopHandlers();
    handlers.onUpload.mockImplementation(async (op: { jobId: string }) => {
      if (op.jobId === 'job-2') throw new Error('upload failed');
    });

    const result = await OfflineQueueService.flush(handlers);

    expect(result.succeeded).toEqual(['job-1']);
    expect(result.failed).toEqual(['job-2']);

    const remaining = await OfflineQueueService.getQueue();
    expect(remaining.map((o) => o.jobId)).toEqual(['job-2']);
  });

  it('reports every op as failed when the credential is missing', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');
    secureBacking.delete('offline_queue_route_code');

    const handlers = noopHandlers();
    const result = await OfflineQueueService.flush(handlers);

    expect(handlers.onUpload).not.toHaveBeenCalled();
    expect(result.failed).toEqual(['job-1']);
    // The op stays queued — it is not the driver's fault the keychain entry went.
    expect(await OfflineQueueService.getQueue()).toHaveLength(1);
  });

  // OfflineBanner is mounted on three driver screens; one reconnect fires one
  // flush per mounted banner. Without coalescing each pending upload runs once
  // per caller.
  it('coalesces concurrent flushes so each op runs exactly once', async () => {
    ioDelayMs = 2;
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');

    const handlers = noopHandlers();
    handlers.onUpload.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const [a, b, c] = await Promise.all([
      OfflineQueueService.flush(handlers),
      OfflineQueueService.flush(handlers),
      OfflineQueueService.flush(handlers),
    ]);

    expect(handlers.onUpload).toHaveBeenCalledTimes(1);
    // Every caller gets the same answer, not a spurious empty result.
    expect(a.succeeded).toEqual(['job-1']);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('starts a fresh run once the previous flush has settled', async () => {
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');
    const handlers = noopHandlers();

    await OfflineQueueService.flush(handlers);
    await OfflineQueueService.enqueue(uploadOp('job-2'), '123456');
    await OfflineQueueService.flush(handlers);

    expect(handlers.onUpload).toHaveBeenCalledTimes(2);
  });

  // The reason flush's per-op removal re-reads under the lock instead of
  // writing back the array it read at the top.
  it('does not erase an op enqueued while an upload was in flight', async () => {
    ioDelayMs = 2;
    await OfflineQueueService.enqueue(uploadOp('job-1'), '123456');

    const handlers = noopHandlers();
    handlers.onUpload.mockImplementation(async () => {
      // Driver finishes another job mid-sync.
      await OfflineQueueService.enqueue(uploadOp('job-late'), '123456');
    });

    await OfflineQueueService.flush(handlers);

    const remaining = await OfflineQueueService.getQueue();
    expect(remaining.map((o) => o.jobId)).toEqual(['job-late']);
  });
});
