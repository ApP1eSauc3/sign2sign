import { useState, useEffect, useCallback, useMemo, memo } from 'react';
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
import { ScreenHeader } from '../components/ScreenHeader';
import { JobCard } from '../components/JobCard';
import { EmptyState } from '../components/EmptyState';

type Props = NativeStackScreenProps<AdminStackParamList, 'AdminRouteDetail'>;

// Stable identities — see DriverRouteScreen for the same reasoning.
const keyExtractor = (j: SignJob) => j.id;
const Separator = () => <View style={styles.separator} />;
const renderItem = ({ item }: { item: SignJob }) => <RouteJobRow job={item} />;

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

  // One pass instead of three separate `.filter().length` sweeps re-run on
  // every render — including every render caused by pull-to-refresh state.
  const { done, installs, removals } = useMemo(() => {
    let done = 0, installs = 0, removals = 0;
    for (const j of jobs) {
      if (j.isComplete) done++;
      if (j.jobType === 'install') installs++;
      else removals++;
    }
    return { done, installs, removals };
  }, [jobs]);

  const total = jobs.length;
  const progressPct = total > 0 ? (done / total) * 100 : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <ScreenHeader
        onBack={() => navigation.goBack()}
        backLabel="Dashboard"
        variant="admin"
      />

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
          keyExtractor={keyExtractor}
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
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={
            <EmptyState
              variant="admin"
              title="No jobs assigned"
              hint="Import a Google Sheet from the dashboard to add jobs to this route."
            />
          }
        />
      )}
    </View>
  );
}

// ─── Job row ─────────────────────────────────────────────────────────────────

// Memoised: admin routes carry the same job counts as driver routes, and a
// pull-to-refresh re-renders the screen. Without this every row rebuilds.
const RouteJobRow = memo(function RouteJobRow({ job }: { job: SignJob }) {
  const footer = job.isComplete && job.photoTimestamp ? (
    <Text style={styles.jobCompletedAt}>
      {`Photo · ${new Date(job.photoTimestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`}
      {job.photoGPSLat
        ? `  ·  ${job.photoGPSLat.toFixed(4)}, ${job.photoGPSLng?.toFixed(4)}`
        : ''}
    </Text>
  ) : !job.isComplete && !job.photoKey ? (
    <Text style={styles.jobPhotoMissing}>Photo not yet taken</Text>
  ) : null;

  return <JobCard job={job} bordered footer={footer} />;
});

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },

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

  // Job row footer content
  jobCompletedAt: {
    fontSize: 12,
    color: colors.adminSuccess,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  jobPhotoMissing: {
    fontSize: 12,
    color: colors.adminTextHint,
    marginTop: 4,
  },
});
