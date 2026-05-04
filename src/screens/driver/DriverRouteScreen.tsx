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
import { SignJob, JobUploadState, AppMode } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { OfflineBanner } from '../OfflineBanner';

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
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.mapButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.mapButtonText}>← Map</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Today's Route</Text>
          <Text style={styles.headerSub}>
            DRIVER {session.driverSlot}  ·  {done}/{total} COMPLETE
          </Text>
        </View>
        <TouchableOpacity
          style={styles.exitButton}
          onPress={handleSignOut}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.exitText}>Exit</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />
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
        <View style={styles.completeHero}>
          <Text style={styles.completeIcon}>✓</Text>
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
        renderItem={({ item }) => (
          <JobCard
            job={item}
            uploadState={uploadStates[item.id] ?? { status: 'idle' }}
            onPress={() => navigation.navigate('DriverJob', { jobId: item.id })}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No jobs assigned</Text>
            <Text style={styles.emptyHint}>Your dispatcher hasn't added any jobs to this route yet. Check back soon.</Text>
          </View>
        }
      />
    </View>
  );
}

// ─── Job card ────────────────────────────────────────────────────────────────

function JobCard({
  job,
  uploadState,
  onPress,
}: {
  job: SignJob;
  uploadState: JobUploadState;
  onPress: () => void;
}) {
  const statusLabel = job.isComplete
    ? 'COMPLETE'
    : uploadState.status === 'uploading'
    ? 'UPLOADING'
    : uploadState.status === 'failed'
    ? 'FAILED'
    : 'PENDING';

  const statusColors = {
    COMPLETE: { bg: colors.statusCompleteBg, text: colors.statusComplete },
    UPLOADING: { bg: colors.statusProgressBg, text: colors.statusProgress },
    FAILED: { bg: colors.statusFailedBg, text: colors.statusFailed },
    PENDING: { bg: colors.statusPendingBg, text: colors.statusPending },
  }[statusLabel];

  const photoTaken = uploadState.status === 'succeeded' || !!job.photoKey;
  const photoLabel = photoTaken ? 'Photo captured' : 'Photo required';
  const photoLabelColor = photoTaken ? colors.statusComplete : colors.textDisabled;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { borderLeftColor: job.jobType === 'install' ? colors.install : colors.removal },
        job.isComplete && styles.cardComplete,
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {/* Row 1: status + type */}
      <View style={styles.cardRow}>
        <View style={[styles.badge, { backgroundColor: statusColors.bg }]}>
          <Text style={[styles.badgeText, { color: statusColors.text }]}>
            {statusLabel}
          </Text>
        </View>
        <View style={[styles.typePill, { borderColor: job.jobType === 'install' ? colors.install : colors.removal }]}>
          <Text style={[styles.typePillText, { color: job.jobType === 'install' ? colors.install : colors.removal }]}>
            {job.jobType.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Row 2: address */}
      <Text style={[styles.address, job.isComplete && styles.addressComplete]}>
        {job.address}
      </Text>

      {/* Row 3: client + agent */}
      <Text style={styles.meta}>
        {job.clientName}
        {job.agentName ? `  ·  ${job.agentName}` : ''}
      </Text>

      {/* Row 4: photo state */}
      <Text style={[styles.photoLabel, { color: photoLabelColor }]}>
        {photoLabel}
      </Text>
    </TouchableOpacity>
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
  mapButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapButtonText: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,           // DESIGN §1.7 — reduced from 24 to fit 3-column header
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brand,
    letterSpacing: 1.2,
    marginTop: 2,
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
  divider: {
    height: 1,
    backgroundColor: colors.border,
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

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,         // DESIGN §1.6 — standard card
    borderLeftWidth: 4,
    padding: 16,
    minHeight: 64,
  },
  cardComplete: {
    backgroundColor: colors.bg,  // DESIGN §1.5 — surface drops to base for completed cards; text tokens handle legibility
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  address: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 24,
    marginBottom: 4,
  },
  addressComplete: {
    color: colors.textSecondary,
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  photoLabel: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Empty state
  emptyState: {
    paddingTop: 48,            // DESIGN §1.3 — breathing room
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 15,
    color: colors.textDisabled,
    textAlign: 'center',
    lineHeight: 22,
  },
});
