import { useMemo, useCallback, memo } from 'react';
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
import { AppMode, SignJob, JobUploadState } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { OfflineBanner } from '../OfflineBanner';
import { ScreenHeader } from '../components/ScreenHeader';
import { JobCard } from '../components/JobCard';
import { EmptyState } from '../components/EmptyState';

type Props = NativeStackScreenProps<DriverStackParamList, 'DriverRoute'>;

// Stable identities — recreating these per render defeats FlatList's own
// bail-out and the row memoisation below.
const NO_JOBS: SignJob[] = [];
// Module-level so the identity is stable — a selector default allocated inline
// would never compare equal under Object.is and would re-render forever.
const IDLE_UPLOAD_STATE: JobUploadState = { status: 'idle' };
const keyExtractor = (j: SignJob) => j.id;
const Separator = () => <View style={styles.separator} />;

export default function DriverRouteScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  // Atomic selectors — see the note in src/stores/CLAUDE.md. Subscribing to the
  // whole store re-rendered this screen on every per-job upload transition.
  const session = useDriverSession((s) => s.session);
  const clearSession = useDriverSession((s) => s.clearSession);
  const setMode = useAppStore((s) => s.setMode);

  // NOTE: `uploadStates` is deliberately NOT selected here. Each row subscribes
  // to its own slice (see DriverJobRow), which keeps `renderItem` independent of
  // upload state — otherwise every photo transition on any job rebuilds the
  // render callback and re-renders every row in the list.

  // One pass for the sort and all four counts. Previously this was a sort plus
  // three separate `.filter().length` sweeps, all re-run on every render.
  // `completedCount()` came from the store as a fifth pass; derived here
  // instead, from data this screen already holds.
  const { jobs, done, installs, removals, incomplete } = useMemo(() => {
    const sorted = [...(session?.jobs ?? NO_JOBS)].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
    );
    let done = 0, installs = 0, removals = 0;
    for (const j of sorted) {
      if (j.isComplete) done++;
      if (j.jobType === 'install') installs++;
      else removals++;
    }
    return { jobs: sorted, done, installs, removals, incomplete: sorted.length - done };
  }, [session?.jobs]);

  const openJob = useCallback(
    (jobId: string) => navigation.navigate('DriverJob', { jobId }),
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: { item: SignJob }) => <DriverJobRow job={item} onOpen={openJob} />,
    [openJob]
  );

  // Every hook above must run on every render — hence the early return sits here.
  if (!session) return null;

  function handleSignOut() {
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
  const total = jobs.length;
  const allComplete = total > 0 && done === total;

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
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
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

// ─── Row ─────────────────────────────────────────────────────────────────────

// Each row subscribes to its OWN upload slice rather than the screen passing
// `uploadStates` down. That is what keeps the list's renderItem stable: if the
// screen selected the whole record, every photo transition on any job would
// produce a new callback identity and re-render every row.
//
// memo() then means a transition on job 7 re-renders row 7 and nothing else.
const DriverJobRow = memo(function DriverJobRow({
  job,
  onOpen,
}: {
  job: SignJob;
  onOpen: (jobId: string) => void;
}) {
  const rawUploadState = useDriverSession((s) => s.uploadStates[job.id]);
  const uploadState: JobUploadState = rawUploadState ?? IDLE_UPLOAD_STATE;

  // photoKey covers a job already completed on a previous session, where the
  // in-memory upload state is 'idle' but the evidence is on the record.
  const photoTaken = uploadState.status === 'succeeded' || !!job.photoKey;

  return (
    <JobCard
      job={job}
      uploadState={uploadState}
      dimWhenComplete
      onPress={() => onOpen(job.id)}
      footer={
        <Text
          style={[
            styles.photoLabel,
            { color: photoTaken ? colors.statusComplete : colors.textDisabled },
          ]}
        >
          {photoTaken ? 'Photo captured' : 'Photo required'}
        </Text>
      }
    />
  );
});

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
