import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DriverStackParamList } from '../../navigation/DriverStack';
import { useDriverSession } from '../../stores/useDriverSession';
import { useAppStore } from '../../stores/useAppStore';
import { AppMode } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { OfflineBanner } from '../OfflineBanner';
import { ScreenHeader } from '../components/ScreenHeader';
import { JobCard } from '../components/JobCard';
import { EmptyState } from '../components/EmptyState';

type Props = NativeStackScreenProps<DriverStackParamList, 'DriverRoute'>;

export default function DriverRouteScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { session, uploadStates, completedCount, clearSession } = useDriverSession();
  const setMode = useAppStore((s) => s.setMode);

  if (!session) return null;

  const jobs = [...session.jobs].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );

  function handleSignOut() {
    const incomplete = jobs.filter((j) => !j.isComplete).length;
    if (incomplete > 0) {
      Alert.alert(
        'Exit Route?',
        `${incomplete} job${incomplete === 1 ? '' : 's'} still in progress. Your progress is saved — re-enter your code to continue.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Exit',
            style: 'destructive',
            onPress: () => { clearSession(); setMode(AppMode.Undecided); },
          },
        ]
      );
      return;
    }
    clearSession();
    setMode(AppMode.Undecided);
  }
  const done = completedCount();
  const total = jobs.length;
  const allComplete = total > 0 && done === total;
  const installs = jobs.filter((j) => j.jobType === 'install').length;
  const removals = jobs.filter((j) => j.jobType === 'removal').length;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <ScreenHeader
        variant="driver"
        boxed
        backLabel="Map"
        onBack={() => navigation.goBack()}
        title="Today's Route"
        subtitle={`DRIVER ${session.driverSlot}  ·  ${done}/${total} COMPLETE`}
        trailing={
          <TouchableOpacity
            style={styles.exitButton}
            onPress={handleSignOut}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.exitText}>Exit</Text>
          </TouchableOpacity>
        }
      />

      <OfflineBanner />

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: total > 0 ? `${(done / total) * 100}%` : '0%' },
          ]}
        />
      </View>

      {/* Route complete hero — shown above the job list when all done */}
      {allComplete && (
        <View style={styles.completeHero} accessibilityRole="header" accessible>
          <Text style={styles.completeIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">✓</Text>
          <Text style={styles.completeTitle}>Route Complete</Text>
          <Text style={styles.completeSub}>
            {installs > 0 ? `${installs} install${installs !== 1 ? 's' : ''}` : ''}
            {installs > 0 && removals > 0 ? '  ·  ' : ''}
            {removals > 0 ? `${removals} removal${removals !== 1 ? 's' : ''}` : ''}
          </Text>
          <Text style={styles.completeDate}>
            {new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        </View>
      )}

      {/* Job list */}
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        renderItem={({ item }) => {
          const uploadState = uploadStates[item.id] ?? { status: 'idle' };
          const photoTaken = uploadState.status === 'succeeded' || !!item.photoKey;
          return (
            <JobCard
              job={item}
              uploadState={uploadState}
              dimWhenComplete
              onPress={() => navigation.navigate('DriverJob', { jobId: item.id })}
              footer={
                <Text style={[styles.photoLabel, { color: photoTaken ? colors.statusComplete : colors.textDisabled }]}>
                  {photoTaken ? 'Photo captured' : 'Photo required'}
                </Text>
              }
            />
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <EmptyState
            variant="driver"
            title="No jobs assigned"
            hint="Your dispatcher hasn't added any jobs to this route yet. Check back soon."
          />
        }
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,  // DESIGN §2.4 — standard page margin
    paddingVertical: 16,
  },
  exitButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exitText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.surface,
  },
  progressFill: {
    height: 3,
    backgroundColor: colors.brand,
  },

  // Route complete hero
  completeHero: {
    marginHorizontal: 16,  // DESIGN §2.4
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: colors.statusCompleteBg,
    borderRadius: 10,      // DESIGN §1.6
    padding: 24,
    alignItems: 'center',
    gap: 4,
  },
  completeIcon: {
    fontSize: 32,
    color: colors.statusComplete,
    lineHeight: 40,
  },
  completeTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.statusComplete,
    marginTop: 4,
  },
  completeSub: {
    fontSize: 14,
    color: colors.statusComplete,
    opacity: 0.8,
    marginTop: 2,
  },
  completeDate: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 8,
  },

  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  separator: {
    height: 8,
  },

  photoLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
});
