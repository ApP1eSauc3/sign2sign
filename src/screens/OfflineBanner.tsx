import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useNetworkStatus } from '../utils/useNetworkStatus';
import { useDriverSession } from '../stores/useDriverSession';
import { colors } from '../utils/colors';

// Drop-in banner — place near the top of any driver screen.
// Appears when offline, disappears and flushes the queue when back online.
export function OfflineBanner() {
  const status = useNetworkStatus();
  const flushOfflineQueue = useDriverSession((s) => s.flushOfflineQueue);
  const opacity = useRef(new Animated.Value(0)).current;
  const prevStatus = useRef(status);

  useEffect(() => {
    if (status === 'offline') {
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    } else if (status === 'online') {
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
      if (prevStatus.current === 'offline') {
        flushOfflineQueue();
      }
    }
    prevStatus.current = status;
  }, [status]);

  if (status === 'unknown') return null;

  return (
    <Animated.View style={[styles.banner, { opacity }]} pointerEvents="none">
      <Text style={styles.text}>
        {status === 'offline'
          ? '⚠  No connection — photos and completions will sync when back online'
          : '✓  Back online — syncing…'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.statusProgressBg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.statusProgress,
  },
  text: {
    color: colors.statusProgress,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
