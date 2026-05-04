import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { RouteCodeService } from '../../services/RouteCodeService';
import { SignJob } from '../../data/SignJob';
import { colors } from '../../utils/colors';

type Props = NativeStackScreenProps<AdminStackParamList, 'AdminRouteDetail'>;

export default function AdminRouteDetailScreen({ route, navigation }: Props) {
  const { routeCodeId, driverSlot, code } = route.params;
  const insets = useSafeAreaInsets();

  const [jobs, setJobs] = useState<SignJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const result = await RouteCodeService.getRouteJobs(routeCodeId);
      setJobs(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load jobs.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [routeCodeId]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const done = jobs.filter((j) => j.isComplete).length;
  const total = jobs.length;
  const installs = jobs.filter((j) => j.jobType === 'install').length;
  const removals = jobs.filter((j) => j.jobType === 'removal').length;
  const progressPct = total > 0 ? (done / total) * 100 : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.back}>← Dashboard</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      {/* Route hero */}
      <View style={styles.hero}>
        <View>
          <Text style={styles.heroSlot}>DRIVER {driverSlot}</Text>
          <Text style={styles.heroCode}>{code}</Text>
        </View>
        <View style={styles.heroStats}>
          {total > 0 && (
            <>
              <Text style={styles.heroStatItem}>
                <Text style={styles.heroStatNum}>{installs}</Text> install{installs !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.heroStatDot}>·</Text>
              <Text style={styles.heroStatItem}>
                <Text style={styles.heroStatNum}>{removals}</Text> removal{removals !== 1 ? 's' : ''}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Progress bar */}
      {total > 0 && (
        <View style={styles.progressSection}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {done} of {total} complete
          </Text>
        </View>
      )}

      <View style={styles.divider} />

      {/* Body */}
      {isLoading ? (
        <View style={styles.centred}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.centred}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadJobs()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(j) => j.id}
          contentContainerStyle={[
            styles.list,
            total === 0 && styles.listEmpty,
            { paddingBottom: insets.bottom + 24 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadJobs(true)}
              tintColor={colors.brand}
            />
          }
          renderItem={({ item }) => <RouteJobRow job={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No jobs assigned</Text>
              <Text style={styles.emptyHint}>
                Import a Google Sheet from the dashboard to add jobs to this route.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// ─── Job row ─────────────────────────────────────────────────────────────────

function RouteJobRow({ job }: { job: SignJob }) {
  const typeColor = job.jobType === 'install' ? colors.install : colors.removal;
  const statusLabel = job.isComplete ? 'COMPLETE' : 'PENDING';
  const statusBg = job.isComplete ? colors.statusCompleteBg : colors.statusPendingBg;
  const statusText = job.isComplete ? colors.statusComplete : colors.statusPending;

  return (
    <View style={[styles.jobRow, { borderLeftColor: typeColor }]}>
      <View style={styles.jobRowMain}>
        <View style={styles.jobRowTop}>
          <View style={[styles.badge, { backgroundColor: statusBg }]}>
            <Text style={[styles.badgeText, { color: statusText }]}>{statusLabel}</Text>
          </View>
          <View style={[styles.typePill, { borderColor: typeColor }]}>
            <Text style={[styles.typePillText, { color: typeColor }]}>
              {job.jobType.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={styles.jobAddress}>{job.address}</Text>
        <Text style={styles.jobMeta}>
          {job.clientName}
          {job.agentName ? `  ·  ${job.agentName}` : ''}
        </Text>
        {job.isComplete && job.photoTimestamp && (
          <Text style={styles.jobCompletedAt}>
            {`Photo · ${new Date(job.photoTimestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}`}
            {job.photoGPSLat
              ? `  ·  ${job.photoGPSLat.toFixed(4)}, ${job.photoGPSLng?.toFixed(4)}`
              : ''}
          </Text>
        )}
        {!job.isComplete && !job.photoKey && (
          <Text style={styles.jobPhotoMissing}>Photo not yet taken</Text>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },

  header: {
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  back: { fontSize: 15, fontWeight: '600', color: colors.brand },

  divider: { height: 1, backgroundColor: colors.adminDivider },

  hero: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  heroSlot: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  heroCode: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.adminText,
    letterSpacing: 6,
    fontVariant: ['tabular-nums'],
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 4,
  },
  heroStatItem: {
    fontSize: 13,
    color: colors.adminTextTertiary,
  },
  heroStatNum: {
    fontWeight: '700',
    color: colors.adminText,
  },
  heroStatDot: {
    color: colors.adminTextTertiary,
  },

  progressSection: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 8,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.adminDivider,
    borderRadius: 3,
  },
  progressFill: {
    height: 6,
    backgroundColor: colors.brand,
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 13,
    color: colors.adminTextTertiary,
    fontWeight: '500',
  },

  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  errorText: {
    fontSize: 15,
    color: colors.adminError,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.adminBorder,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: colors.brand },

  list: { paddingHorizontal: 16, paddingTop: 16 },
  listEmpty: { flex: 1 },
  separator: { height: 8 },

  // Job row
  jobRow: {
    backgroundColor: colors.adminSurface,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: colors.adminCardBorder,
    overflow: 'hidden',
  },
  jobRowMain: { padding: 14 },
  jobRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  typePillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  jobAddress: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.adminText,
    marginBottom: 4,
  },
  jobMeta: { fontSize: 13, color: colors.adminTextTertiary, marginBottom: 4 },
  jobCompletedAt: {
    fontSize: 12,
    color: colors.adminSuccess,
    fontVariant: ['tabular-nums'],
  },
  jobPhotoMissing: {
    fontSize: 12,
    color: colors.adminTextHint,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.adminTextTertiary },
  emptyHint: {
    fontSize: 14,
    color: colors.adminTextHint,
    textAlign: 'center',
    lineHeight: 20,
  },
});
