import * as Network from 'expo-network';
import { AppState } from 'react-native';
import { __testing } from '../useNetworkStatus';

jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn() } }));

const mockNetwork = Network.getNetworkStateAsync as jest.Mock;
const mockAddEventListener = AppState.addEventListener as jest.Mock;

const { subscribe, getSnapshot, check } = __testing;

let removeAppStateListener: jest.Mock;

// The hook body is one line delegating to useSyncExternalStore. What is worth
// testing is the module-level store it delegates TO — plain TypeScript, so it
// runs under this project's node test environment without pulling in a
// renderer (see TESTING.md on why screen rendering would need a second jest
// project). These tests call subscribe/getSnapshot exactly as React would.
beforeEach(() => {
  __testing.reset();
  removeAppStateListener = jest.fn();
  mockAddEventListener.mockReturnValue({ remove: removeAppStateListener });
  mockNetwork.mockResolvedValue({ isConnected: true, isInternetReachable: true });
});

afterEach(() => __testing.reset());

// ─── The gap this rewrite closes ─────────────────────────────────────────────

describe('one poller for the whole app', () => {
  it('starts nothing until the first subscriber arrives', () => {
    expect(__testing.isPolling).toBe(false);
    expect(mockAddEventListener).not.toHaveBeenCalled();
  });

  // OfflineBanner is mounted on all three driver screens and React Navigation
  // keeps them mounted, so the previous per-hook useState+setInterval meant
  // three five-second polls and three AppState listeners for an entire shift.
  it('runs a single timer and a single AppState listener for many subscribers', () => {
    const a = subscribe(jest.fn());
    const b = subscribe(jest.fn());
    const c = subscribe(jest.fn());

    expect(__testing.listenerCount).toBe(3);
    expect(__testing.isPolling).toBe(true);
    expect(mockAddEventListener).toHaveBeenCalledTimes(1);

    a(); b(); c();
  });

  it('keeps polling while any subscriber remains, and stops at the last one', () => {
    const first = subscribe(jest.fn());
    const second = subscribe(jest.fn());

    first();
    expect(__testing.isPolling).toBe(true);      // second is still listening
    expect(removeAppStateListener).not.toHaveBeenCalled();

    second();
    expect(__testing.isPolling).toBe(false);
    expect(__testing.listenerCount).toBe(0);
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });

  it('restarts cleanly after every subscriber has gone', () => {
    subscribe(jest.fn())();
    expect(__testing.isPolling).toBe(false);

    subscribe(jest.fn());
    expect(__testing.isPolling).toBe(true);
    expect(mockAddEventListener).toHaveBeenCalledTimes(2);
  });

  it('probes on the foreground transition, not only on the interval', async () => {
    subscribe(jest.fn());
    const handler = mockAddEventListener.mock.calls[0][1] as (s: string) => void;

    mockNetwork.mockClear();
    handler('background');
    expect(mockNetwork).not.toHaveBeenCalled();

    handler('active');
    expect(mockNetwork).toHaveBeenCalledTimes(1);
  });
});

// ─── Snapshot semantics ──────────────────────────────────────────────────────

describe('snapshot', () => {
  it('starts unknown so the banner renders nothing before the first probe', () => {
    expect(getSnapshot()).toBe('unknown');
  });

  it('notifies subscribers once when the status actually changes', async () => {
    const listener = jest.fn();
    subscribe(listener);

    await check();
    expect(getSnapshot()).toBe('online');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // useSyncExternalStore re-reads the snapshot on every notification, so
  // notifying when nothing changed is a wasted render in every subscriber.
  it('does not notify when a probe returns the same status', async () => {
    const listener = jest.fn();
    subscribe(listener);

    await check();
    listener.mockClear();
    await check();
    await check();

    expect(listener).not.toHaveBeenCalled();
    expect(getSnapshot()).toBe('online');
  });

  it('returns a referentially stable snapshot between changes', async () => {
    await check();
    expect(getSnapshot()).toBe(getSnapshot());
  });

  // subscribe() probes immediately rather than waiting a full interval, so a
  // screen that mounts while offline shows the banner at once instead of five
  // seconds later.
  it('probes immediately on the first subscribe', async () => {
    mockNetwork.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const listener = jest.fn();
    subscribe(listener);

    await Promise.resolve();   // let the immediate probe settle
    expect(getSnapshot()).toBe('offline');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('flips to offline when the device disconnects, and back', async () => {
    const listener = jest.fn();
    subscribe(listener);
    await check();                 // settle the immediate probe: unknown -> online
    listener.mockClear();

    mockNetwork.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    await check();
    expect(getSnapshot()).toBe('offline');

    mockNetwork.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await check();
    expect(getSnapshot()).toBe('online');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  // isInternetReachable is undefined on several Android versions and on web.
  // Treating undefined as "not reachable" would pin the offline banner on
  // permanently for those devices, so only an explicit false counts.
  it('treats an undefined isInternetReachable as online', async () => {
    mockNetwork.mockResolvedValue({ isConnected: true, isInternetReachable: undefined });
    await check();
    expect(getSnapshot()).toBe('online');
  });

  it('treats an explicit isInternetReachable=false as offline', async () => {
    mockNetwork.mockResolvedValue({ isConnected: true, isInternetReachable: false });
    await check();
    expect(getSnapshot()).toBe('offline');
  });

  // A probe that throws is not evidence of being offline. Flapping the status
  // would flap OfflineBanner and, through it, fire a spurious queue flush.
  it('holds the last known status when the probe throws', async () => {
    const listener = jest.fn();
    subscribe(listener);

    await check();
    expect(getSnapshot()).toBe('online');

    listener.mockClear();
    mockNetwork.mockRejectedValue(new Error('module unavailable'));
    await check();

    expect(getSnapshot()).toBe('online');
    expect(listener).not.toHaveBeenCalled();
  });

  // Remounting a driver screen should not blink the banner back through
  // 'unknown' while the first probe of the new subscription resolves.
  it('retains the last known status across a full unsubscribe/resubscribe', async () => {
    const unsubscribe = subscribe(jest.fn());
    mockNetwork.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    await check();
    expect(getSnapshot()).toBe('offline');

    unsubscribe();
    expect(getSnapshot()).toBe('offline');

    subscribe(jest.fn());
    expect(getSnapshot()).toBe('offline');
  });
});
