import { memo } from 'react';
import { View, Text } from 'react-native';
import { SignJob } from '../../../data/SignJob';
import { colors } from '../../../utils/colors';
import { styles } from './styles';

// ─── Job pin marker ───────────────────────────────────────────────────────────

// Memoised: a route of n jobs renders n pins, and without this every one of
// them re-renders whenever any single job's state changes. Props are a job
// object (stable reference from the store) and a number, so the default
// shallow compare is exactly right.
export const JobPin = memo(function JobPin({ job, routeIndex }: { job: SignJob; routeIndex: number }) {
  const pinColor = job.isComplete
    ? colors.textDisabled
    : job.jobType === 'install'
    ? colors.install
    : colors.removal;

  return (
    <View style={styles.pinContainer}>
      <View
        style={[
          styles.pinCircle,
          { backgroundColor: pinColor },
          job.isComplete && styles.pinComplete,
        ]}
      >
        <Text style={styles.pinText}>
          {job.isComplete ? '✓' : String(routeIndex)}
        </Text>
      </View>
      {/* Downward triangle pointer */}
      <View style={[styles.pinPointer, { borderTopColor: pinColor }]} />
    </View>
  );
});
