import { useSyncExternalStore } from 'react';
import * as Network from 'expo-network';
import { AppState, AppStateStatus } from 'react-native';

export type NetworkStatus = 'online' | 'offline' | 'unknown';

// expo-network has no real-time subscription, so polling is the correct
// approach in the managed workflow. What changed on 2026-08-21 is that there is
// now exactly ONE poller for the whole app instead of one per hook call.
//
// Why that mattered: OfflineBanner is mounted on all three driver screens, and
// React Navigation keeps a stack's screens mounted. A driver on the job screen
// with the route and map still below it had THREE independent five-second
// intervals plus three AppState listeners running for the whole shift — on a
// phone that lives in a truck all day. It is the same root cause as the
// duplicate offline-queue flush fixed in OfflineQueueService: per-component
// instances of something that should be per-app.
//
// The store below is subscribed to via useSyncExternalStore, React's supported
// primitive for exactly this shape. It hands React a snapshot to compare rather
// than a useState the hook has to push into, which keeps every subscriber
// consistent within a render pass.

const POLL_INTERVAL_MS = 5000;

let currentStatus: NetworkStatus = 'unknown';
const listeners = new Set<() => void>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

// Snapshot must be referentially stable between changes. NetworkStatus is a
// string literal, so returning the module variable directly is safe — React
// compares with Object.is and a same-value read never schedules a render.
function getSnapshot(): NetworkStatus {
  return currentStatus;
}

// Web/static render has no network module to poll and no listeners attached.
// Reporting 'unknown' means OfflineBanner renders nothing, which is correct:
// the banner is a driver-flow concern and the driver flow is native-only.
function getServerSnapshot(): NetworkStatus {
  return 'unknown';
}

async function check(): Promise<void> {
  let next: NetworkStatus;
  try {
    const state = await Network.getNetworkStateAsync();
    next = state.isConnected === true && state.isInternetReachable !== false ? 'online' : 'offline';
  } catch {
    // A failed probe is not evidence of being offline — do not flap the banner
    // (and, through OfflineBanner, do not trigger a spurious queue flush).
    return;
  }

  if (next === currentStatus) return;   // no change, no re-render
  currentStatus = next;
  for (const listener of listeners) listener();
}

function startPolling(): void {
  if (pollTimer !== null) return;
  void check();
  pollTimer = setInterval(() => void check(), POLL_INTERVAL_MS);
  appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') void check();
  });
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
  // Deliberately keep currentStatus. The next mount shows the last known value
  // immediately instead of flashing 'unknown' while the first probe resolves.
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  startPolling();                       // no-op if already running
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) stopPolling();
  };
}

export function useNetworkStatus(): NetworkStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Test seam. The polling lifecycle is the behaviour worth testing and it is
// module-level state, which persists across tests in a suite.
export const __testing = {
  reset(): void {
    stopPolling();
    listeners.clear();
    currentStatus = 'unknown';
  },
  get listenerCount(): number {
    return listeners.size;
  },
  get isPolling(): boolean {
    return pollTimer !== null;
  },
  check,
  // `subscribe` and `getSnapshot` are what useSyncExternalStore calls. Exposing
  // them lets the lifecycle be tested for real under the node environment,
  // instead of asserting around it.
  subscribe,
  getSnapshot,
};
