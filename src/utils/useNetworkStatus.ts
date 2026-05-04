import { useState, useEffect, useRef } from 'react';
import * as Network from 'expo-network';
import { AppState, AppStateStatus } from 'react-native';

export type NetworkStatus = 'online' | 'offline' | 'unknown';

// Polls every 5 seconds and on app foreground — expo-network has no real-time
// subscription, so polling is the correct approach in managed workflow.
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>('unknown');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function check() {
    const state = await Network.getNetworkStateAsync();
    const isOnline = state.isConnected === true && state.isInternetReachable !== false;
    setStatus(isOnline ? 'online' : 'offline');
  }

  useEffect(() => {
    check();
    intervalRef.current = setInterval(check, 5000);

    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') check();
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
  }, []);

  return status;
}
